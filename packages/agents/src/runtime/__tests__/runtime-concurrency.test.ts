// Two runs at once, and one run inside another.
//
// The rule is ISOLATION rather than serialization: each run gets its own context and its own
// queue, so two runs cannot pool their actions into one batch however their awaits interleave,
// and a run started inside another run simply works. Serializing runs would deadlock exactly
// there — the outer run cannot finish until the inner one has, and the inner one could not start
// until the outer had — so a lock would turn nesting from "supported" into "hangs".
//
// What is still serial is the DOCUMENT: `host.execute` is synchronous, so batches happen one at a
// time in the order their `sync()` calls do, each atomic on its own. That is also where two
// overlapping writers meet: a context that decided something from a read it has since been
// overtaken on is refused (`StaleDocument`) rather than applied on top. These tests force the
// interleavings by hand with gates, because a test that merely started two runs would pass
// whether or not the isolation existed.

import { describe, expect, test } from 'bun:test';
import { createRuntime } from '../runtime.ts';
import { MiniDocument, type MiniParagraph } from '../examples/minimal-model.ts';
import { openHost, spyHost } from './support/hosts.ts';
import { docx, p } from './support/docx.ts';

function gate(): { wait: Promise<void>; open: () => void } {
  let open!: () => void;
  const wait = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { wait, open };
}

async function caught(work: Promise<unknown>): Promise<{ code?: unknown }> {
  try {
    await work;
  } catch (error) {
    return error as { code?: unknown };
  }
  throw new Error('expected a rejection');
}

function bodyText(runtime: ReturnType<typeof createRuntime>): Promise<string> {
  return runtime.run(async (context) => {
    const body = MiniDocument.open(context).body;
    body.load('text');
    await context.sync();
    return body.text;
  });
}

describe('a run inside a run', () => {
  test('completes, with its own context and its own queue', async () => {
    const spy = spyHost(openHost());
    const runtime = createRuntime({ host: spy.host, save: true });
    const both = await runtime.run(async (outer) => {
      const body = MiniDocument.open(outer).body;
      body.load('text');
      spy.reset();
      const inner = await runtime.run(async (context) => {
        expect(context).not.toBe(outer);
        const paragraphs = MiniDocument.open(context).body.paragraphs;
        paragraphs.load();
        // The outer run's queued read is not in this batch, and this sync does not empty it.
        await context.sync();
        return paragraphs.items.length;
      });
      expect(spy.requests.map((request) => request.operations.map((o) => o.op))).toEqual([
        ['getParagraphs'],
      ]);
      await outer.sync();
      return [body.text, inner] as const;
    });
    expect(both).toEqual(['alpha\nbeta', 2]);
    runtime.dispose();
  });

  test('what the inner run wrote is in the document the outer run reads next', async () => {
    const runtime = createRuntime({ host: openHost(docx(p('base'))), save: true });
    const text = await runtime.run(async (outer) => {
      await runtime.run(async (context) => {
        const paragraphs = MiniDocument.open(context).body.paragraphs;
        paragraphs.load();
        await context.sync();
        paragraphs.items[0]!.insertText('inner ', 0);
        await context.sync();
      });
      const body = MiniDocument.open(outer).body;
      body.load('text');
      await outer.sync();
      return body.text;
    });
    expect(text).toBe('inner base');
    runtime.dispose();
  });

  test('the inner run releases its own objects when it ends, and leaves the outer run\u2019s alone', async () => {
    const runtime = createRuntime({ host: openHost(), save: true });
    await runtime.run(async (outer) => {
      const ours = MiniDocument.open(outer).body.paragraphs;
      ours.load();
      await outer.sync();
      let theirs: MiniParagraph | undefined;
      await runtime.run(async (context) => {
        const paragraphs = MiniDocument.open(context).body.paragraphs;
        paragraphs.load();
        await context.sync();
        theirs = paragraphs.items[0]!;
      });
      expect(() => theirs!.load('text')).toThrowError(
        expect.objectContaining({ code: 'InvalidObjectPath' })
      );
      ours.items[0]!.load('text');
      await outer.sync();
      expect(ours.items[0]!.text).toBe('alpha');
    });
    runtime.dispose();
  });
});

describe('two runs overlapping on one runtime', () => {
  test('their batches never merge, whatever order the syncs happen in', async () => {
    const spy = spyHost(openHost());
    const runtime = createRuntime({ host: spy.host, save: true });
    const held = gate();
    spy.reset();

    const first = runtime.run(async (context) => {
      const body = MiniDocument.open(context).body;
      body.load('text');
      // Queued, then deliberately overtaken: the other run syncs while this one is waiting.
      await held.wait;
      await context.sync();
      return body.text;
    });
    const second = runtime.run(async (context) => {
      const paragraphs = MiniDocument.open(context).body.paragraphs;
      paragraphs.load();
      await context.sync();
      held.open();
      return paragraphs.items.length;
    });

    expect(await Promise.all([first, second])).toEqual(['alpha\nbeta', 2]);
    expect(spy.requests.map((request) => request.operations.map((o) => o.op))).toEqual([
      ['getParagraphs'],
      ['getText'],
    ]);
    runtime.dispose();
  });

  test('when both write from a read, one applies and the other is refused whole', async () => {
    const runtime = createRuntime({ host: openHost(docx(p('base'))), save: true });
    const bothRead = gate();
    const firstWrote = gate();

    const winner = runtime.run(async (context) => {
      const paragraphs = MiniDocument.open(context).body.paragraphs;
      paragraphs.load();
      await context.sync();
      await bothRead.wait;
      paragraphs.items[0]!.insertText('winner ', 0);
      await context.sync();
      firstWrote.open();
      return 'applied';
    });
    const loser = runtime.run(async (context) => {
      const paragraphs = MiniDocument.open(context).body.paragraphs;
      paragraphs.load();
      await context.sync();
      bothRead.open();
      await firstWrote.wait;
      paragraphs.items[0]!.insertText('loser ', 0);
      return caught(context.sync());
    });

    expect(await winner).toBe('applied');
    expect(await loser).toMatchObject({ code: 'StaleDocument' });
    // Exactly one of the two writes is in the document — never a mixture.
    expect(await bodyText(runtime)).toBe('winner base');
    runtime.dispose();
  });
});

describe('separate runtimes', () => {
  test('run concurrently without touching each other\u2019s documents', async () => {
    const one = createRuntime({ host: openHost(docx(p('one'))), save: true });
    const two = createRuntime({ host: openHost(docx(p('two'))), save: true });

    const write = (runtime: ReturnType<typeof createRuntime>, text: string) =>
      runtime.run(async (context) => {
        const paragraphs = MiniDocument.open(context).body.paragraphs;
        paragraphs.load();
        await context.sync();
        paragraphs.items[0]!.insertText(text, 0);
        await context.sync();
      });

    await Promise.all([write(one, 'ONE '), write(two, 'TWO ')]);
    expect(await Promise.all([bodyText(one), bodyText(two)])).toEqual(['ONE one', 'TWO two']);

    // And each saves only its own document.
    const [savedOne, savedTwo] = await Promise.all([one.save(), two.save()]);
    const reopened = [savedOne, savedTwo].map((bytes) =>
      createRuntime({ host: openHost(bytes), save: true })
    );
    expect(await Promise.all(reopened.map(bodyText))).toEqual(['ONE one', 'TWO two']);
    for (const runtime of [one, two, ...reopened]) runtime.dispose();
  });

  test('disposing one leaves the other working', async () => {
    const one = createRuntime({ host: openHost(docx(p('one'))), save: true });
    const two = createRuntime({ host: openHost(docx(p('two'))), save: true });
    one.dispose();
    await expect(one.run(async () => 1)).rejects.toMatchObject({ code: 'RuntimeDisposed' });
    expect(await bodyText(two)).toBe('two');
    two.dispose();
  });
});

// Handover: what `run(object, callback)` is allowed to do.
//
// Adoption moves an object from one run to another, and that move is the only moment in this
// runtime when a proxy changes which queue it feeds and which registry decides its lifetime. Two
// things follow, and neither is optional:
//
// ONE OWNER AT A TIME. An object whose run is still going is still that run's. Rebinding it would
// send that run's next call into a different context's batch — the interleaving the whole
// one-context-one-queue design exists to prevent — and would leave two registries claiming the same
// lifetime, so `trackedObjects.remove` on one could release an object the other is mid-batch on.
// So adoption from a LIVE owner is refused, by name, and a handover from a finished one disowns the
// object on the way out.
//
// THE READ IT CAME WITH TRAVELS WITH IT. An adopted object carries state read at some revision, and
// a write computed from that state is exactly the read-decide-write hazard conditional batches
// exist for. The offset a stale `text.length` produces is usually still IN RANGE, so the document
// would accept it and write into the wrong place — a silent corruption, not an error. The adopting
// context therefore inherits the revision the reading context saw, and its first write is
// conditional on it.

import { describe, expect, test } from 'bun:test';
import type {
  AutomationBatchResponse,
  AutomationHandle,
  AutomationHost,
} from '@docx-editor.dev/core-contract/automation';
import { createRuntime } from '../runtime.ts';
import { messageFor } from '../errors.ts';
import { hydratedHandle, hydratedHandles } from '../hydrate.ts';
import { internalsOf } from '../internals.ts';
import type { RequestContext } from '../request-context.ts';
import { MiniDocument, MiniParagraph } from '../examples/minimal-model.ts';
import { openHost, spyHost } from './support/hosts.ts';
import { docx, p } from './support/docx.ts';

const IN_USE = expect.objectContaining({ code: 'ObjectInUse' });

async function caught(work: Promise<unknown>): Promise<{
  code?: unknown;
  message?: unknown;
  expectedRevision?: unknown;
  actualRevision?: unknown;
}> {
  try {
    await work;
  } catch (error) {
    return error as { code?: unknown };
  }
  throw new Error('expected a rejection');
}

/** Read the first paragraph and its text, track it, and hand back the run's context too. */
function keptParagraph(runtime: ReturnType<typeof createRuntime>): Promise<{
  paragraph: MiniParagraph;
  source: RequestContext;
}> {
  return runtime.run(async (context) => {
    const paragraphs = MiniDocument.open(context).body.paragraphs;
    paragraphs.load();
    await context.sync();
    const first = paragraphs.items[0]!;
    first.load('text');
    await context.sync();
    context.trackedObjects.add(first);
    return { paragraph: first, source: context };
  });
}

function bodyText(runtime: ReturnType<typeof createRuntime>): Promise<string> {
  return runtime.run(async (context) => {
    const body = MiniDocument.open(context).body;
    body.load('text');
    await context.sync();
    return body.text;
  });
}

/** Another run, prepending to the first paragraph, so the document moves under everyone else. */
async function moveDocument(runtime: ReturnType<typeof createRuntime>): Promise<void> {
  await runtime.run(async (context) => {
    const paragraphs = MiniDocument.open(context).body.paragraphs;
    paragraphs.load();
    await context.sync();
    paragraphs.items[0]!.insertText('theirs ', 0);
    await context.sync();
  });
}

function gate(): { wait: Promise<void>; open: () => void } {
  let open!: () => void;
  const wait = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { wait, open };
}

/** The first paragraph's handle, taken straight from the host — the shape a caller may already hold. */
function paragraphHandleOf(host: AutomationHost): AutomationHandle {
  const value = (response: AutomationBatchResponse) => {
    const first = response.results[0];
    if (first?.status !== 'ok') throw new Error('test setup could not reach the document');
    return first.value;
  };
  const document = hydratedHandle(
    value(host.execute({ operations: [{ op: 'getDocument' }] })),
    'setup'
  );
  const body = hydratedHandle(
    value(host.execute({ operations: [{ op: 'getBody', document }] })),
    'setup'
  );
  const paragraphs = hydratedHandles(
    value(host.execute({ operations: [{ op: 'getParagraphs', body }] })),
    'setup'
  );
  const first = paragraphs[0];
  if (!first) throw new Error('test setup found no paragraphs');
  return first;
}

describe('adoption while the owner is still running', () => {
  test('is refused, and says the object is in use rather than pretending it is gone', async () => {
    const runtime = createRuntime({ host: openHost(), save: true });
    await runtime.run(async (outer) => {
      const paragraphs = MiniDocument.open(outer).body.paragraphs;
      paragraphs.load();
      await outer.sync();
      const first = paragraphs.items[0]!;
      outer.trackedObjects.add(first);

      const failure = await caught(runtime.run(first, async () => 'adopted'));
      expect(failure).toMatchObject({ code: 'ObjectInUse' });
      expect(failure.message).toBe(messageFor('ObjectInUse'));
    });
    runtime.dispose();
  });

  test('leaves the object where it was: same context, still tracked, still usable there', async () => {
    // The refusal has to happen BEFORE the rebind. A refusal after it would report an error and
    // still have moved the object, which is the worst of both.
    const runtime = createRuntime({ host: openHost(), save: true });
    await runtime.run(async (outer) => {
      const paragraphs = MiniDocument.open(outer).body.paragraphs;
      paragraphs.load();
      await outer.sync();
      const first = paragraphs.items[0]!;
      outer.trackedObjects.add(first);
      await caught(runtime.run(first, async () => 1));

      expect(first.context).toBe(outer);
      expect(internalsOf(outer).isTracked(first)).toBe(true);
      first.load('text');
      await outer.sync();
      expect(first.text).toBe('alpha');
    });
    runtime.dispose();
  });

  test('the refused run queued nothing and sent nothing', async () => {
    const spy = spyHost(openHost());
    const runtime = createRuntime({ host: spy.host, save: true });
    await runtime.run(async (outer) => {
      const paragraphs = MiniDocument.open(outer).body.paragraphs;
      paragraphs.load();
      await outer.sync();
      const first = paragraphs.items[0]!;
      outer.trackedObjects.add(first);
      spy.reset();

      await caught(
        runtime.run(first, async (inner) => {
          first.insertText('never ', 0);
          await inner.sync();
        })
      );
      expect(spy.requests).toHaveLength(0);
      expect(internalsOf(outer).queue.size).toBe(0);
    });
    expect(await bodyText(runtime)).toBe('alpha\nbeta');
    runtime.dispose();
  });

  test('an untracked object from a live run is in use, not released', async () => {
    // Both would be refusals and only one of them is true: `InvalidObjectPath` says the object has
    // been released, and it has not — its run is still going.
    const runtime = createRuntime({ host: openHost(), save: true });
    await runtime.run(async (outer) => {
      const paragraphs = MiniDocument.open(outer).body.paragraphs;
      paragraphs.load();
      await outer.sync();
      await expect(runtime.run(paragraphs.items[0]!, async () => 1)).rejects.toThrowError(IN_USE);
    });
    runtime.dispose();
  });

  test('a run that merely overlaps the owner is refused the same way', async () => {
    // Overlapping rather than nested: the owner is parked on a gate, still live, while another run
    // tries to take its object — and carries on working once the attempt has been refused.
    const runtime = createRuntime({ host: openHost(), save: true });
    const published = gate();
    const attempted = gate();
    let held: MiniParagraph | undefined;

    const owner = runtime.run(async (context) => {
      const paragraphs = MiniDocument.open(context).body.paragraphs;
      paragraphs.load();
      await context.sync();
      held = paragraphs.items[0]!;
      context.trackedObjects.add(held);
      published.open();
      await attempted.wait;
      held.load('text');
      await context.sync();
      return held.text;
    });

    await published.wait;
    expect(await caught(runtime.run(held!, async () => 1))).toMatchObject({ code: 'ObjectInUse' });
    attempted.open();
    expect(await owner).toBe('alpha');
    runtime.dispose();
  });

  test('and it can be adopted once that run has ended', async () => {
    const runtime = createRuntime({ host: openHost(docx(p('kept'))), save: true });
    const { paragraph } = await keptParagraph(runtime);
    await expect(runtime.run(paragraph, async () => 'adopted')).resolves.toBe('adopted');
    runtime.dispose();
  });
});

describe('a handover leaves exactly one owner', () => {
  test('the object belongs to the adopting context, and the source no longer claims it', async () => {
    const runtime = createRuntime({ host: openHost(docx(p('kept'))), save: true });
    const { paragraph, source } = await keptParagraph(runtime);
    await runtime.run(paragraph, async (context) => {
      expect(paragraph.context).toBe(context);
      expect(internalsOf(source).isTracked(paragraph)).toBe(false);
      expect(internalsOf(context).isTracked(paragraph)).toBe(true);
    });
    runtime.dispose();
  });

  test('its actions go to the adopting queue and to no other', async () => {
    const spy = spyHost(openHost(docx(p('kept'))));
    const runtime = createRuntime({ host: spy.host, save: true });
    const { paragraph, source } = await keptParagraph(runtime);
    spy.reset();

    const text = await runtime.run(paragraph, async (context) => {
      paragraph.insertText('still ', 0);
      expect(internalsOf(context).queue.size).toBe(1);
      expect(internalsOf(source).queue.size).toBe(0);
      await context.sync();
      paragraph.load('text');
      await context.sync();
      return paragraph.text;
    });

    expect(text).toBe('still kept');
    expect(spy.requests.map((request) => request.operations.map((o) => o.op))).toEqual([
      ['insertText'],
      ['getText'],
    ]);
    runtime.dispose();
  });

  test('adopting the same object twice in one call is not a second handover', async () => {
    const runtime = createRuntime({ host: openHost(docx(p('kept'))), save: true });
    const { paragraph } = await keptParagraph(runtime);
    await expect(runtime.run([paragraph, paragraph], async () => 'adopted')).resolves.toBe(
      'adopted'
    );
    runtime.dispose();
  });
});

describe('the revision an adopted read was taken at', () => {
  test('travels with the object, so a write computed from stale state is refused', async () => {
    const spy = spyHost(openHost(docx(p('base'))));
    const runtime = createRuntime({ host: spy.host, save: true });
    const { paragraph } = await keptParagraph(runtime);
    const readAt = spy.host.revision();
    expect(paragraph.text).toBe('base');

    await moveDocument(runtime);

    // `'base'.length` is 4 and the document now holds 'theirs base', so that offset is still in
    // range: unconditionally, this would write inside the other run's word.
    const failure = await caught(
      runtime.run(paragraph, async (context) => {
        paragraph.insertText('!', paragraph.text.length);
        await context.sync();
      })
    );

    expect(failure).toMatchObject({ code: 'StaleDocument', expectedRevision: readAt });
    expect(failure.actualRevision as number).toBeGreaterThan(readAt);
    expect(await bodyText(runtime)).toBe('theirs base');
    runtime.dispose();
  });

  test('is on the batch itself, not just on the error', async () => {
    const spy = spyHost(openHost(docx(p('base'))));
    const runtime = createRuntime({ host: spy.host, save: true });
    const { paragraph } = await keptParagraph(runtime);
    const readAt = spy.host.revision();
    spy.reset();

    await runtime.run(paragraph, async (context) => {
      paragraph.insertText('mine ', 0);
      await context.sync();
    });

    expect(spy.requests).toHaveLength(1);
    expect(spy.requests[0]?.expectedRevision).toBe(readAt);
    expect(await bodyText(runtime)).toBe('mine base');
    runtime.dispose();
  });

  test('a fresh read in the adopting run supersedes it', async () => {
    // Inheriting a revision must not make an adopting run permanently stale: a context that has
    // read again has seen the document as it is now, and its writes are conditional on that.
    const runtime = createRuntime({ host: openHost(docx(p('base'))), save: true });
    const { paragraph } = await keptParagraph(runtime);
    await moveDocument(runtime);

    const text = await runtime.run(paragraph, async (context) => {
      paragraph.load('text');
      await context.sync();
      paragraph.insertText('mine ', 0);
      await context.sync();
      paragraph.load('text');
      await context.sync();
      return paragraph.text;
    });
    expect(text).toBe('mine theirs base');
    runtime.dispose();
  });

  test('the oldest of several adopted reads is the one the batch carries', async () => {
    // Two objects from two finished runs that read at different revisions. Conditional on the NEWER
    // one, a decision made from the older one's state would be applied.
    const spy = spyHost(openHost(docx(p('base'))));
    const runtime = createRuntime({ host: spy.host, save: true });

    const { paragraph: early } = await keptParagraph(runtime);
    const earlyRevision = spy.host.revision();
    await moveDocument(runtime);
    const { paragraph: late } = await keptParagraph(runtime);
    expect(spy.host.revision()).toBeGreaterThan(earlyRevision);
    spy.reset();

    const failure = await caught(
      runtime.run([early, late], async (context) => {
        late.insertText('!', 0);
        await context.sync();
      })
    );
    expect(failure).toMatchObject({ code: 'StaleDocument', expectedRevision: earlyRevision });
    expect(spy.requests[0]?.expectedRevision).toBe(earlyRevision);
    runtime.dispose();
  });

  test('a context that carries no read at all still writes unconditionally', async () => {
    // The rule is about what the CONTEXT has read, not about where a handle came from. A caller
    // holding a handle and issuing a command has nothing to be stale about, and making that
    // conditional would refuse ordinary unconditional writes for no reason.
    const spy = spyHost(openHost(docx(p('base'))));
    const runtime = createRuntime({ host: spy.host, save: true });
    const handle = paragraphHandleOf(spy.host);
    spy.reset();

    await runtime.run(async (context) => {
      MiniParagraph.at(context, 'document.body.paragraphs.items[0]', handle).insertText('mine ', 0);
      await context.sync();
    });

    expect(spy.requests).toHaveLength(1);
    expect(spy.requests[0]?.expectedRevision).toBeUndefined();
    expect(await bodyText(runtime)).toBe('mine base');
    runtime.dispose();
  });
});

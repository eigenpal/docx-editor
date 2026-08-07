/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// How long a proxy lives, and who decides.
//
// A document object is a reference into a document that keeps moving, so the default has to be
// that it dies with the run that made it. What makes that safe rather than annoying is that the
// death is LOUD: a released object refuses every call with `InvalidObjectPath` instead of
// silently addressing whatever now sits where it used to point.
//
// Keeping one alive is therefore deliberate in both directions — `trackedObjects.add` says "I
// will hand this to another run", and handing it over is `run(object, callback)`, which is the
// point where the new context takes responsibility for it. Tracking without adoption gets a
// context error, not a working object; adopting without tracking is refused. Neither of those is
// a technicality: they are what stops a long-lived reference being created by accident.

import { describe, expect, test } from 'bun:test';
import { createRuntime } from '../runtime.ts';
import type { Paragraph } from '../../model/index.ts';
import { openHost, spyHost } from './support/hosts.ts';
import { docx, p } from './support/docx.ts';

const INVALID_PATH = expect.objectContaining({ code: 'InvalidObjectPath' });

async function firstParagraph(
  runtime: ReturnType<typeof createRuntime>,
  options: { track: boolean }
): Promise<Paragraph> {
  return runtime.run(async (context) => {
    const paragraphs = context.document.body.paragraphs;
    paragraphs.load();
    await context.sync();
    const first = paragraphs.items[0]!;
    first.load('text');
    await context.sync();
    if (options.track) context.trackedObjects.add(first);
    return first;
  });
}

describe('a proxy dies with its run unless something kept it', () => {
  test('an untracked object refuses every call once its run has ended', async () => {
    const runtime = createRuntime({ host: openHost(), save: true });
    const escaped = await firstParagraph(runtime, { track: false });
    expect(() => escaped.load('text')).toThrowError(INVALID_PATH);
    expect(() => escaped.insertText('x', 'Start')).toThrowError(INVALID_PATH);
    expect(() => escaped.delete()).toThrowError(INVALID_PATH);
    expect(() => escaped.isNullObject).toThrowError(INVALID_PATH);
    runtime.dispose();
  });

  test('a value it had already loaded is still readable — that is a copy, not a document read', async () => {
    const runtime = createRuntime({ host: openHost(), save: true });
    const escaped = await firstParagraph(runtime, { track: false });
    expect(escaped.text).toBe('alpha');
    runtime.dispose();
  });

  test('a tracked object survives, and its finished context is what refuses further work', async () => {
    const runtime = createRuntime({ host: openHost(), save: true });
    const kept = await firstParagraph(runtime, { track: true });
    // Not `InvalidObjectPath`: the object is fine, the run it belonged to is over. The
    // distinction is the whole reason tracking exists — and `run(object, ...)` is the fix.
    expect(() => kept.load('text')).toThrowError(
      expect.objectContaining({ code: 'InvalidRequestContext' })
    );
    runtime.dispose();
  });

  test('a tracked object can be adopted by another run and used there', async () => {
    const runtime = createRuntime({ host: openHost(docx(p('kept'))), save: true });
    const kept = await firstParagraph(runtime, { track: true });
    const text = await runtime.run(kept, async (context) => {
      kept.insertText('still ', 'Start');
      await context.sync();
      kept.load('text');
      await context.sync();
      return kept.text;
    });
    expect(text).toBe('still kept');
    runtime.dispose();
  });

  test('adopting keeps it tracked, so it survives the adopting run too', async () => {
    const runtime = createRuntime({ host: openHost(), save: true });
    const kept = await firstParagraph(runtime, { track: true });
    await runtime.run(kept, async (context) => {
      kept.load('text');
      await context.sync();
    });
    const again = await runtime.run([kept], async (context) => {
      kept.load('text');
      await context.sync();
      return kept.text;
    });
    expect(again).toBe('alpha');
    runtime.dispose();
  });

  test('an object nobody tracked cannot be adopted', async () => {
    const runtime = createRuntime({ host: openHost(), save: true });
    const escaped = await firstParagraph(runtime, { track: false });
    await expect(runtime.run(escaped, async () => 1)).rejects.toMatchObject({
      code: 'InvalidObjectPath',
    });
    runtime.dispose();
  });

  test('an object from another runtime cannot be adopted, however alike the documents are', async () => {
    // Two runtimes over the same bytes. The handles are not transferable — they name objects in
    // one host's document — and adoption is where that gets caught rather than at a read that
    // would otherwise resolve against the wrong document.
    const one = createRuntime({ host: openHost(), save: true });
    const other = createRuntime({ host: openHost(), save: true });
    const kept = await firstParagraph(one, { track: true });
    await expect(other.run(kept, async () => 1)).rejects.toMatchObject({
      code: 'InvalidObjectPath',
    });
    one.dispose();
    other.dispose();
  });

  test('remove withdraws the intent: the object is released when the run ends', async () => {
    const runtime = createRuntime({ host: openHost(), save: true });
    const dropped = await runtime.run(async (context) => {
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load();
      await context.sync();
      const first = paragraphs.items[0]!;
      context.trackedObjects.add(first);
      context.trackedObjects.remove(first);
      return first;
    });
    expect(() => dropped.load('text')).toThrowError(INVALID_PATH);
    runtime.dispose();
  });

  test('add and remove are both idempotent', async () => {
    const runtime = createRuntime({ host: openHost(), save: true });
    const kept = await runtime.run(async (context) => {
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load();
      await context.sync();
      const first = paragraphs.items[0]!;
      const second = paragraphs.items[1]!;
      context.trackedObjects.remove(first);
      context.trackedObjects.add([first, second]);
      context.trackedObjects.add(first);
      context.trackedObjects.remove(second);
      context.trackedObjects.remove(second);
      return first;
    });
    await expect(runtime.run(kept, async () => 'adopted')).resolves.toBe('adopted');
    runtime.dispose();
  });

  test('a context will not track an object it does not own', async () => {
    const runtime = createRuntime({ host: openHost(), save: true });
    const kept = await firstParagraph(runtime, { track: true });
    await runtime.run(async (context) => {
      expect(() => context.trackedObjects.add(kept)).toThrowError(INVALID_PATH);
    });
    runtime.dispose();
  });

  test('a finished context refuses to sync', async () => {
    const runtime = createRuntime({ host: openHost(), save: true });
    const escaped = await runtime.run(async (context) => context);
    await expect(escaped.sync()).rejects.toMatchObject({ code: 'InvalidRequestContext' });
    runtime.dispose();
  });
});

describe('the other half of InvalidObjectPath: an object that is not addressable YET', () => {
  // One code covers two states, and only one of them is fixed by tracking. A consumer who reached
  // a paragraph through a search hit's `getFirst()` was told "the object is no longer usable …
  // unless context.trackedObjects.add(...) kept them", which describes the state they were not in
  // — so they tracked an object that had never been released and it did not help. The state they
  // were in is fixed by one more `sync()`, and the sentence has to say so.
  test('a promised object refuses, and the refusal names the sync that fixes it', async () => {
    const runtime = createRuntime({ host: openHost(docx(p('find me'))), save: true });
    await runtime.run(async (context) => {
      const found = context.document.body.search('me');
      found.load();
      await context.sync();

      const promised = found.items[0]!.paragraphs.getFirst();
      // Not released: nothing has ended. Not addressable either, until the read answers.
      let refusal: { code?: unknown; message?: string } = {};
      try {
        promised.load('text');
      } catch (error) {
        refusal = error as { code?: unknown; message?: string };
      }
      expect(refusal.code).toBe('InvalidObjectPath');
      expect(refusal.message).toContain('context.sync()');

      // And the fix the message names is the fix: one sync, then the object works.
      await context.sync();
      promised.load('text');
      await context.sync();
      expect(promised.text).toBe('find me');
    });
    runtime.dispose();
  });

  test('the released half still says what keeps an object alive', async () => {
    const runtime = createRuntime({ host: openHost(), save: true });
    const escaped = await firstParagraph(runtime, { track: false });
    expect(() => escaped.load('text')).toThrowError(
      expect.objectContaining({ message: expect.stringContaining('trackedObjects.add') })
    );
    runtime.dispose();
  });
});

describe('a callback that throws', () => {
  test('rejects with what was thrown, applies nothing, and releases the objects', async () => {
    const spy = spyHost(openHost(docx(p('untouched'))));
    const runtime = createRuntime({ host: spy.host, save: true });
    let escaped: Paragraph | undefined;
    const boom = new Error('callback gave up');

    await expect(
      runtime.run(async (context) => {
        const paragraphs = context.document.body.paragraphs;
        paragraphs.load();
        await context.sync();
        escaped = paragraphs.items[0]!;
        // Queued and never synced: a callback that threw did not ask for this to happen.
        escaped.insertText('WRITTEN ', 'Start');
        spy.reset();
        throw boom;
      })
    ).rejects.toBe(boom);

    // No auto-sync on the way out: nothing was sent after the throw.
    expect(spy.requests).toHaveLength(0);
    expect(() => escaped!.load('text')).toThrowError(INVALID_PATH);

    const after = await runtime.run(async (context) => {
      const body = context.document.body;
      body.load('text');
      await context.sync();
      return body.text;
    });
    expect(after).toBe('untouched');
    runtime.dispose();
  });

  test('a tracked object still survives a callback that threw', async () => {
    const runtime = createRuntime({ host: openHost(), save: true });
    let kept: Paragraph | undefined;
    await expect(
      runtime.run(async (context) => {
        const paragraphs = context.document.body.paragraphs;
        paragraphs.load();
        await context.sync();
        kept = paragraphs.items[0]!;
        context.trackedObjects.add(kept);
        throw new Error('later');
      })
    ).rejects.toThrow('later');
    const text = await runtime.run(kept!, async (context) => {
      kept!.load('text');
      await context.sync();
      return kept!.text;
    });
    expect(text).toBe('alpha');
    runtime.dispose();
  });
});

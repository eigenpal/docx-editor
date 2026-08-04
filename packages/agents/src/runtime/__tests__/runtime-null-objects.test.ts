// "Or null object": a lookup that does not break the batch it is part of.
//
// The alternative — a lookup that throws when nothing was found — cannot work in a batching API,
// because the lookup has not happened yet at the moment the consumer needs its result to keep
// building the batch. So the proxy comes back immediately with NO VERDICT, and the sync that
// looked is what settles it. That "no verdict" state is the part worth pinning down: it must be
// an error to read, never a plausible `false`, because a `false` would send a consumer on to use
// an object that does not exist.

import { describe, expect, test } from 'bun:test';
import { createRuntime } from '../runtime.ts';
import { MiniDocument } from '../examples/minimal-model.ts';
import { openHost } from './support/hosts.ts';

describe('an item that may not be there', () => {
  test('isNullObject has no answer until the sync that looked', async () => {
    const runtime = createRuntime({ host: openHost(), save: true });
    await runtime.run(async (context) => {
      const item = MiniDocument.open(context).body.paragraphs.getItemOrNullObject(0);
      expect(() => item.isNullObject).toThrowError(
        expect.objectContaining({
          code: 'PropertyNotLoaded',
          target: 'document.body.paragraphs.items[0].isNullObject',
        })
      );
      await context.sync();
      expect(item.isNullObject).toBe(false);
    });
    runtime.dispose();
  });

  test('an item that was there is a usable object afterwards', async () => {
    const runtime = createRuntime({ host: openHost(), save: true });
    const text = await runtime.run(async (context) => {
      const item = MiniDocument.open(context).body.paragraphs.getItemOrNullObject(1);
      await context.sync();
      item.load('text');
      await context.sync();
      return item.text;
    });
    expect(text).toBe('beta');
    runtime.dispose();
  });

  test('an item that was not there says so, and the batch still succeeded', async () => {
    const runtime = createRuntime({ host: openHost(), save: true });
    await runtime.run(async (context) => {
      const missing = MiniDocument.open(context).body.paragraphs.getItemOrNullObject(9);
      // No rejection: a lookup that found nothing is an answer, not a failure.
      await context.sync();
      expect(missing.isNullObject).toBe(true);
    });
    runtime.dispose();
  });

  test('a null object refuses to be used, and says which object it was', async () => {
    const runtime = createRuntime({ host: openHost(), save: true });
    await runtime.run(async (context) => {
      const missing = MiniDocument.open(context).body.paragraphs.getItemOrNullObject(9);
      await context.sync();
      const expected = expect.objectContaining({
        code: 'InvalidObjectPath',
        target: 'document.body.paragraphs.items[9]',
      });
      expect(() => missing.load('text')).toThrowError(expected);
      expect(() => missing.insertText('x', 0)).toThrowError(expected);
    });
    runtime.dispose();
  });

  test('the verdict comes from the document, not from the index', async () => {
    // Both lookups are in one batch and neither has an answer while it is being built; the
    // difference between them appears only after the document answered.
    const runtime = createRuntime({ host: openHost(), save: true });
    await runtime.run(async (context) => {
      const paragraphs = MiniDocument.open(context).body.paragraphs;
      const there = paragraphs.getItemOrNullObject(1);
      const notThere = paragraphs.getItemOrNullObject(2);
      await context.sync();
      expect([there.isNullObject, notThere.isNullObject]).toEqual([false, true]);
    });
    runtime.dispose();
  });

  test('an index that is not an index is refused at the call', async () => {
    const runtime = createRuntime({ host: openHost(), save: true });
    await runtime.run(async (context) => {
      const paragraphs = MiniDocument.open(context).body.paragraphs;
      for (const index of [-1, 1.5, Number.NaN]) {
        expect(() => paragraphs.getItemOrNullObject(index)).toThrowError(
          expect.objectContaining({
            code: 'InvalidArgument',
            target: 'document.body.paragraphs.getItemOrNullObject',
          })
        );
      }
    });
    runtime.dispose();
  });

  test('an object that cannot be null answers immediately', async () => {
    const runtime = createRuntime({ host: openHost(), save: true });
    await runtime.run(async (context) => {
      expect(MiniDocument.open(context).body.isNullObject).toBe(false);
    });
    runtime.dispose();
  });
});

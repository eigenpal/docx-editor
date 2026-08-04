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
import { docx } from './support/docx.ts';
import { openHost } from './support/hosts.ts';

/** A document with a body but no paragraph in it: a lookup there finds nothing. */
const NO_PARAGRAPHS = docx('');

describe('an item that may not be there', () => {
  test('isNullObject has no answer until the sync that looked', async () => {
    const runtime = createRuntime({ host: openHost(), save: true });
    await runtime.run(async (context) => {
      const item = context.document.body.paragraphs.getFirstOrNullObject();
      expect(() => item.isNullObject).toThrowError(
        expect.objectContaining({
          code: 'PropertyNotLoaded',
          target: 'document.body.paragraphs.getFirstOrNullObject().isNullObject',
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
      const item = context.document.body.paragraphs.getLastOrNullObject();
      await context.sync();
      item.load('text');
      await context.sync();
      return item.text;
    });
    expect(text).toBe('beta');
    runtime.dispose();
  });

  test('an item that was not there says so, and the batch still succeeded', async () => {
    const runtime = createRuntime({ host: openHost(NO_PARAGRAPHS), save: true });
    await runtime.run(async (context) => {
      const missing = context.document.body.paragraphs.getFirstOrNullObject();
      // No rejection: a lookup that found nothing is an answer, not a failure.
      await context.sync();
      expect(missing.isNullObject).toBe(true);
    });
    runtime.dispose();
  });

  test('a null object refuses to be used, and says which object it was', async () => {
    const runtime = createRuntime({ host: openHost(NO_PARAGRAPHS), save: true });
    await runtime.run(async (context) => {
      const missing = context.document.body.paragraphs.getFirstOrNullObject();
      await context.sync();
      const expected = expect.objectContaining({
        code: 'InvalidObjectPath',
        target: 'document.body.paragraphs.getFirstOrNullObject()',
      });
      expect(() => missing.load('text')).toThrowError(expected);
      expect(() => missing.insertText('x', 'End')).toThrowError(expected);
    });
    runtime.dispose();
  });

  test('the verdict comes from the document, not from the call', async () => {
    // Both lookups are written the same way and neither has an answer while the batch is being
    // built; the difference between them appears only after the document answered.
    const runtime = createRuntime({ host: openHost(), save: true });
    const empty = createRuntime({ host: openHost(NO_PARAGRAPHS), save: true });
    const verdicts = await runtime.run(async (context) =>
      empty.run(async (other) => {
        const there = context.document.body.paragraphs.getFirstOrNullObject();
        const notThere = other.document.body.paragraphs.getFirstOrNullObject();
        await context.sync();
        await other.sync();
        return [there.isNullObject, notThere.isNullObject];
      })
    );
    expect(verdicts).toEqual([false, true]);
    runtime.dispose();
    empty.dispose();
  });

  test('the form that cannot be null refuses instead, naming the call', async () => {
    const runtime = createRuntime({ host: openHost(NO_PARAGRAPHS), save: true });
    await expect(
      runtime.run(async (context) => {
        context.document.body.paragraphs.getFirst();
        await context.sync();
      })
    ).rejects.toThrowError(
      expect.objectContaining({
        code: 'ItemNotFound',
        target: 'document.body.paragraphs.getFirst()',
      })
    );
    runtime.dispose();
  });

  test('an object that cannot be null answers immediately', async () => {
    const runtime = createRuntime({ host: openHost(), save: true });
    await runtime.run(async (context) => {
      expect(context.document.body.isNullObject).toBe(false);
    });
    runtime.dispose();
  });
});

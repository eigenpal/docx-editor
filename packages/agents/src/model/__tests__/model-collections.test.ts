// The two answers a collection can hold, and what its edges do with each.
//
// Most collections are a QUESTION: "the paragraphs of this story" is a read, sent when the
// collection is loaded. One is an ANSWER already: the ranges a `split` produced arrive with the
// command that produced them, because listing them afterwards would describe the document the
// split made rather than the pieces it made. Both kinds have `getFirst()`, and a consumer cannot
// be expected to know which kind it is holding — so both have to behave the same way.
//
// This file reaches the collection directly, which the tests next door deliberately do not: an
// answer with NO members is a shape the public API cannot currently produce (a split always
// answers at least the paragraph it was given), and the behaviour when it does is exactly what a
// later operation answering a collection would depend on. Testing it through a document would mean
// waiting for that operation to exist before the empty case had any coverage at all.

import { describe, expect, test } from 'bun:test';
import { isDocxEditorError } from '../../runtime/errors.ts';
import { RangeCollection } from '../collections.ts';
import { serverRuntime } from './support/documents.ts';

/** A command-answered collection, and the answer it would be filled with. */
async function answeredWith(spans: readonly unknown[]): Promise<{
  first: { isNullObject: boolean } | null;
  code: string | null;
}> {
  const runtime = await serverRuntime();
  return runtime.run(async (context) => {
    const body = context.document.body;
    const pieces = RangeCollection.answered(context, 'pieces', internalPathOf(body));
    const nullable = pieces.getFirstOrNullObject();
    let code: string | null = null;
    try {
      pieces.fill({ kind: 'spans', spans } as never, 'pieces');
    } catch (error) {
      code = isDocxEditorError(error) ? error.code : 'unknown';
    }
    return { first: code ? null : { isNullObject: nullable.isNullObject }, code };
  });
}

/** The owner path a collection derives from. Reaching for it is the point of this file. */
function internalPathOf(owner: object): never {
  return (owner as { path: never }).path;
}

describe('a collection the command filled', () => {
  test('answers an or-null-object edge as null when the answer holds nothing', async () => {
    // No range came back, so there is no first range. `isNullObject` is the whole reason this form
    // exists: the alternative — an object that reads as an empty range — would be a range at a
    // position in a document, which is a lie about a document nobody looked at.
    const outcome = await answeredWith([]);
    expect(outcome.code).toBeNull();
    expect(outcome.first).toEqual({ isNullObject: true });
  });

  test('and fails the plain edge, because there was no member to answer with', async () => {
    const runtime = await serverRuntime();
    const code = await runtime.run(async (context) => {
      const pieces = RangeCollection.answered(
        context,
        'pieces',
        internalPathOf(context.document.body)
      );
      pieces.getFirst();
      try {
        pieces.fill({ kind: 'spans', spans: [] } as never, 'pieces');
        return null;
      } catch (error) {
        return isDocxEditorError(error) ? error.code : 'unknown';
      }
    });
    expect(code).toBe('ItemNotFound');
  });

  test('and hydrates both edges when the answer holds members', async () => {
    const runtime = await serverRuntime();
    const outcome = await runtime.run(async (context) => {
      const body = context.document.body;
      const paragraphs = body.paragraphs;
      paragraphs.load();
      await context.sync();
      const handle = (
        paragraphs.items[0] as unknown as { path: { handle(): unknown } }
      ).path.handle();
      const other = (
        paragraphs.items[1] as unknown as { path: { handle(): unknown } }
      ).path.handle();
      const pieces = RangeCollection.answered(context, 'pieces', internalPathOf(body));
      const head = pieces.getFirst();
      const tail = pieces.getLast();
      pieces.fill(
        {
          kind: 'spans',
          spans: [
            { start: { paragraph: handle, offset: 0 }, end: { paragraph: handle, offset: 5 } },
            { start: { paragraph: other, offset: 0 }, end: { paragraph: other, offset: 4 } },
          ],
        } as never,
        'pieces'
      );
      head.load('text');
      tail.load('text');
      await context.sync();
      return [head.text, tail.text];
    });
    expect(outcome).toEqual(['alpha', 'beta']);
  });
});

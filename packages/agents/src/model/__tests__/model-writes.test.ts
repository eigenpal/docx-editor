// What the object model can change, and what it refuses to change.
//
// Every write here is checked twice: once by reading the document back in the same runtime, and —
// for the ones where the shape of the document changed — once after a save and a reopen, because an
// edit that reads back correctly in the session that made it but does not survive the serializer has
// been applied to a picture of a document rather than to a document.

import { describe, expect, test } from 'bun:test';
import { isDocxEditorError } from '../../runtime/errors.ts';
import type { DocxEditorServerRuntime } from '../../runtime/runtime.ts';
import {
  EMPTY_BODY,
  TABLE_DOCUMENT,
  TWO_PARAGRAPHS,
  docx,
  p,
  pWithId,
  reopen,
  serverRuntime,
} from './support/documents.ts';

async function codeOf(call: () => Promise<unknown>): Promise<string> {
  try {
    await call();
  } catch (error) {
    if (isDocxEditorError(error)) return error.code;
    throw error;
  }
  throw new Error('the call did not fail');
}

/** Every paragraph's text, in reading order — one batch, for readable expectations. */
async function paragraphTexts(runtime: DocxEditorServerRuntime): Promise<string[]> {
  return runtime.run(async (context) => {
    const paragraphs = context.document.body.paragraphs;
    paragraphs.load();
    await context.sync();
    for (const paragraph of paragraphs.items) paragraph.load('text');
    await context.sync();
    return paragraphs.items.map((paragraph) => paragraph.text);
  });
}

/** The same, after the document has been through the serializer. */
async function textsAfterReopen(runtime: DocxEditorServerRuntime): Promise<string[]> {
  return paragraphTexts(await reopen(runtime));
}

describe('writing text into a story', () => {
  test('at the start and at the end, and the answer names the text that was written', async () => {
    const runtime = await serverRuntime(docx(p('middle')));
    const written = await runtime.run(async (context) => {
      const body = context.document.body;
      const head = body.insertText('<', 'Start');
      await context.sync();
      const tail = body.insertText('>', 'End');
      await context.sync();

      head.load('text');
      tail.load('text');
      await context.sync();
      return [head.text, tail.text];
    });
    expect(written).toEqual(['<', '>']);
    expect(await paragraphTexts(runtime)).toEqual(['<middle>']);
    expect(await textsAfterReopen(runtime)).toEqual(['<middle>']);
  });

  test('over the whole story, which leaves one paragraph holding the new text', async () => {
    const runtime = await serverRuntime();
    await runtime.run(async (context) => {
      context.document.body.insertText('only this', 'Replace');
      await context.sync();
    });
    expect(await paragraphTexts(runtime)).toEqual(['only this']);
    expect(await textsAfterReopen(runtime)).toEqual(['only this']);
  });

  test('an insert location this API does not have is refused at the call', async () => {
    const runtime = await serverRuntime();
    const code = await codeOf(() =>
      runtime.run(async (context) => {
        (context.document.body.insertText as (t: string, l: string) => unknown)('x', 'Ende');
      })
    );
    expect(code).toBe('InvalidArgument');
  });

  test('text carrying a paragraph mark is refused rather than written into a run', async () => {
    const runtime = await serverRuntime();
    const code = await codeOf(() =>
      runtime.run(async (context) => {
        context.document.body.insertText('one\ntwo', 'End');
      })
    );
    expect(code).toBe('InvalidArgument');
    expect(await paragraphTexts(runtime)).toEqual(['alpha', 'beta']);
  });
});

describe('clearing a story', () => {
  test('leaves one empty paragraph', async () => {
    const runtime = await serverRuntime();
    await runtime.run(async (context) => {
      context.document.body.clear();
      await context.sync();
    });
    expect(await paragraphTexts(runtime)).toEqual(['']);
    expect(await textsAfterReopen(runtime)).toEqual(['']);
  });

  test('is refused on a story that holds no paragraph, rather than inventing one', async () => {
    const runtime = await serverRuntime(EMPTY_BODY);
    const code = await codeOf(() =>
      runtime.run(async (context) => {
        context.document.body.clear();
        await context.sync();
      })
    );
    expect(code).toBe('InvalidArgument');
  });
});

describe('adding a paragraph to a story', () => {
  test('at the start and at the end, and each answer is the paragraph that was added', async () => {
    const runtime = await serverRuntime();
    const texts = await runtime.run(async (context) => {
      const body = context.document.body;
      const head = body.insertParagraph('first', 'Start');
      await context.sync();
      const tail = body.insertParagraph('last', 'End');
      await context.sync();

      head.load('text');
      tail.load('text');
      await context.sync();
      return [head.text, tail.text];
    });
    expect(texts).toEqual(['first', 'last']);
    expect(await paragraphTexts(runtime)).toEqual(['first', 'alpha', 'beta', 'last']);
    expect(await textsAfterReopen(runtime)).toEqual(['first', 'alpha', 'beta', 'last']);
  });

  test('beside another one, on either side', async () => {
    const runtime = await serverRuntime(docx(p('anchor')));
    await runtime.run(async (context) => {
      const anchor = context.document.body.paragraphs.getFirst();
      await context.sync();
      anchor.insertParagraph('above', 'Before');
      await context.sync();
      anchor.insertParagraph('below', 'After');
      await context.sync();
    });
    expect(await paragraphTexts(runtime)).toEqual(['above', 'anchor', 'below']);
    expect(await textsAfterReopen(runtime)).toEqual(['above', 'anchor', 'below']);
  });

  test('leaves the anchor naming its own text, on either side', async () => {
    // The one guarantee worth having: after inserting beside a paragraph, the proxy the caller
    // already had still names the paragraph they were looking at, whichever side the new one went.
    // (`Before` is the interesting direction — the engine builds it by splitting, so the anchor's
    // content moves to a different node and the handle has to follow it.)
    const runtime = await serverRuntime(docx(p('anchor')));
    const texts = await runtime.run(async (context) => {
      const anchor = context.document.body.paragraphs.getFirst();
      await context.sync();

      anchor.insertParagraph('above', 'Before');
      await context.sync();
      anchor.load('text');
      await context.sync();
      const afterBefore = anchor.text;

      anchor.insertParagraph('below', 'After');
      await context.sync();
      anchor.load('text');
      await context.sync();
      return [afterBefore, anchor.text];
    });
    expect(texts).toEqual(['anchor', 'anchor']);
    expect(await paragraphTexts(runtime)).toEqual(['above', 'anchor', 'below']);
  });

  test('after another one, the anchor keeps the identity the document gave it', async () => {
    const runtime = await serverRuntime(docx(pWithId('anchor', '11111111')));
    const identity = await runtime.run(async (context) => {
      const anchor = context.document.body.paragraphs.getFirst();
      await context.sync();
      anchor.insertParagraph('below', 'After');
      await context.sync();
      anchor.load('uniqueLocalId');
      await context.sync();
      return anchor.uniqueLocalId;
    });
    expect(identity).toBe('11111111');
  });

  test('before another one, the anchor\u2019s identity stays with the node the file wrote', async () => {
    // Not an assertion that this is desirable. `uniqueLocalId` is an attribute of a `w:p` in the
    // file, and the engine builds "insert before" by splitting the anchor — which leaves the FIRST
    // half on the original node. So the paragraph now above keeps the id, and the anchor's content,
    // which the proxy correctly follows, is on a node with a new one. A consumer holding an id
    // rather than the proxy would be pointing at the wrong paragraph, which is why this is written
    // down rather than left to be discovered.
    const runtime = await serverRuntime(docx(pWithId('anchor', '22222222')));
    const [anchorId, aboveId] = await runtime.run(async (context) => {
      const paragraphs = context.document.body.paragraphs;
      const anchor = paragraphs.getFirst();
      await context.sync();
      anchor.insertParagraph('above', 'Before');
      await context.sync();

      const listed = context.document.body.paragraphs;
      listed.load();
      anchor.load('uniqueLocalId');
      await context.sync();
      listed.items[0]!.load('uniqueLocalId');
      await context.sync();
      return [anchor.uniqueLocalId, listed.items[0]!.uniqueLocalId];
    });
    expect(aboveId).toBe('22222222');
    expect(anchorId).not.toBe('22222222');
  });
});

describe('writing into one paragraph', () => {
  test('over it, at its start, and at its end', async () => {
    const runtime = await serverRuntime(docx(`${p('one')}${p('two')}${p('three')}`));
    await runtime.run(async (context) => {
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load();
      await context.sync();
      const [first, second, third] = paragraphs.items;
      first!.insertText('ONE', 'Replace');
      second!.insertText('<', 'Start');
      third!.insertText('>', 'End');
      await context.sync();
    });
    expect(await paragraphTexts(runtime)).toEqual(['ONE', '<two', 'three>']);
    expect(await textsAfterReopen(runtime)).toEqual(['ONE', '<two', 'three>']);
  });

  test('the answer is a range over the text that was written', async () => {
    const runtime = await serverRuntime(docx(p('abc')));
    const text = await runtime.run(async (context) => {
      const paragraph = context.document.body.paragraphs.getFirst();
      await context.sync();
      const written = paragraph.insertText('XY', 'Start');
      await context.sync();
      written.load('text');
      await context.sync();
      return written.text;
    });
    expect(text).toBe('XY');
  });

  test('offsets are UTF-16 units, so writing at the end of astral text keeps it whole', async () => {
    const runtime = await serverRuntime(docx(p('a\u{1F600}')));
    await runtime.run(async (context) => {
      const paragraph = context.document.body.paragraphs.getFirst();
      await context.sync();
      paragraph.insertText('!', 'End');
      await context.sync();
    });
    expect(await paragraphTexts(runtime)).toEqual(['a\u{1F600}!']);
    expect(await textsAfterReopen(runtime)).toEqual(['a\u{1F600}!']);
  });

  test('clearing empties it and leaves the paragraph in place', async () => {
    const runtime = await serverRuntime();
    await runtime.run(async (context) => {
      const paragraph = context.document.body.paragraphs.getFirst();
      await context.sync();
      paragraph.clear();
      await context.sync();
    });
    expect(await paragraphTexts(runtime)).toEqual(['', 'beta']);
    expect(await textsAfterReopen(runtime)).toEqual(['', 'beta']);
  });

  test('deleting removes it', async () => {
    const runtime = await serverRuntime();
    await runtime.run(async (context) => {
      const paragraph = context.document.body.paragraphs.getFirst();
      await context.sync();
      paragraph.delete();
      await context.sync();
    });
    expect(await paragraphTexts(runtime)).toEqual(['beta']);
    expect(await textsAfterReopen(runtime)).toEqual(['beta']);
  });

  test('deleting a table cell\u2019s only paragraph is refused, because a cell must keep one', async () => {
    // Not this API's rule: a `w:tc` with no `w:p` is markup Word rejects and a cell no caret can
    // enter (17.4.66), so the document store refuses the removal and the batch is refused with it.
    // Worth pinning here because the model offers no way to tell in advance — a paragraph inside a
    // cell is an ordinary paragraph until the moment it is the last one.
    const runtime = await serverRuntime(TABLE_DOCUMENT);
    const code = await codeOf(() =>
      runtime.run(async (context) => {
        const paragraphs = context.document.body.paragraphs;
        paragraphs.load();
        await context.sync();
        paragraphs.items[1]!.delete();
        await context.sync();
      })
    );
    expect(code).toBe('GeneralException');
    expect(await paragraphTexts(runtime)).toEqual(['before', 'in cell', 'other cell', 'after']);
  });

  test('a paragraph the document no longer has refuses the next write', async () => {
    const runtime = await serverRuntime();
    const code = await codeOf(() =>
      runtime.run(async (context) => {
        const paragraph = context.document.body.paragraphs.getFirst();
        await context.sync();
        paragraph.delete();
        await context.sync();
        paragraph.insertText('x', 'End');
        await context.sync();
      })
    );
    expect(code).toBe('InvalidObjectPath');
    expect(await paragraphTexts(runtime)).toEqual(['beta']);
  });
});

describe('splitting a paragraph', () => {
  test('answers one range per piece, in reading order, including the original', async () => {
    const runtime = await serverRuntime(docx(p('a;b;c')));
    const texts = await runtime.run(async (context) => {
      const paragraph = context.document.body.paragraphs.getFirst();
      await context.sync();
      const pieces = paragraph.split([';'], true);
      pieces.load();
      await context.sync();
      for (const piece of pieces.items) piece.load('text');
      await context.sync();
      return pieces.items.map((piece) => piece.text);
    });
    expect(texts).toEqual(['a', 'b', 'c']);
    expect(await paragraphTexts(runtime)).toEqual(['a', 'b', 'c']);
    expect(await textsAfterReopen(runtime)).toEqual(['a', 'b', 'c']);
  });

  test('keeps the delimiters unless it is asked to drop them', async () => {
    const runtime = await serverRuntime(docx(p('a;b')));
    await runtime.run(async (context) => {
      const paragraph = context.document.body.paragraphs.getFirst();
      await context.sync();
      paragraph.split([';']);
      await context.sync();
    });
    expect(await paragraphTexts(runtime)).toEqual(['a;', 'b']);
  });

  test('trims spacing off the answered ranges when asked', async () => {
    const runtime = await serverRuntime(docx(p('a ; b')));
    const texts = await runtime.run(async (context) => {
      const paragraph = context.document.body.paragraphs.getFirst();
      await context.sync();
      const pieces = paragraph.split([';'], true, true);
      pieces.load();
      await context.sync();
      for (const piece of pieces.items) piece.load('text');
      await context.sync();
      return pieces.items.map((piece) => piece.text);
    });
    expect(texts).toEqual(['a', 'b']);
  });

  test('with no delimiter at all is refused at the call', async () => {
    const runtime = await serverRuntime();
    const code = await codeOf(() =>
      runtime.run(async (context) => {
        const paragraph = context.document.body.paragraphs.getFirst();
        await context.sync();
        paragraph.split([]);
      })
    );
    expect(code).toBe('InvalidArgument');
  });
});

describe('writing through a range', () => {
  test('replaces what it covers', async () => {
    const runtime = await serverRuntime(docx(p('hello world')));
    await runtime.run(async (context) => {
      const found = context.document.body.search('world');
      found.load();
      await context.sync();
      found.items[0]!.insertText('there', 'Replace');
      await context.sync();
    });
    expect(await paragraphTexts(runtime)).toEqual(['hello there']);
    expect(await textsAfterReopen(runtime)).toEqual(['hello there']);
  });

  test('writes at either edge, and Before/Start and After/End land in the same place', async () => {
    const runtime = await serverRuntime(docx(`${p('[x]')}${p('[x]')}`));
    await runtime.run(async (context) => {
      const found = context.document.body.search('x');
      found.load();
      await context.sync();
      found.items[0]!.insertText('<', 'Start');
      found.items[1]!.insertText('(', 'Before');
      await context.sync();
    });
    expect(await paragraphTexts(runtime)).toEqual(['[<x]', '[(x]']);
  });

  test('deletes what it covers when the replacement is empty', async () => {
    const runtime = await serverRuntime(docx(p('keep drop')));
    await runtime.run(async (context) => {
      const found = context.document.body.search(' drop');
      found.load();
      await context.sync();
      found.items[0]!.insertText('', 'Replace');
      await context.sync();
    });
    expect(await paragraphTexts(runtime)).toEqual(['keep']);
    expect(await textsAfterReopen(runtime)).toEqual(['keep']);
  });

  test('adds a paragraph beside the one it starts in', async () => {
    const runtime = await serverRuntime(docx(p('anchor')));
    await runtime.run(async (context) => {
      const found = context.document.body.search('anchor');
      found.load();
      await context.sync();
      found.items[0]!.insertParagraph('after', 'After');
      await context.sync();
    });
    expect(await paragraphTexts(runtime)).toEqual(['anchor', 'after']);
  });

  test('selecting is refused where there is no reader to move', async () => {
    const runtime = await serverRuntime();
    const code = await codeOf(() =>
      runtime.run(async (context) => {
        const found = context.document.body.search('alpha');
        found.load();
        await context.sync();
        found.items[0]!.select();
      })
    );
    expect(code).toBe('NotSupported');
  });
});

describe('writing through an object a read has not answered for yet', () => {
  test('is refused: an item accessor needs one sync before it can be written through', async () => {
    // The shape upstream allows and this runtime does not. `getFirst()` answers a proxy whose
    // address is the answer to a read, and a read answers at a sync — so a write queued before that
    // sync has nothing to name. Refusing is the deliberate half of "one sync is one atomic batch":
    // the alternative is quietly sending several batches per sync so a chained path can resolve.
    const runtime = await serverRuntime();
    const code = await codeOf(() =>
      runtime.run(async (context) => {
        const found = context.document.body.search('alpha');
        found.load();
        await context.sync();
        const first = found.getFirst();
        first.insertText('!', 'End');
      })
    );
    expect(code).toBe('InvalidObjectPath');
    expect(await paragraphTexts(runtime)).toEqual(['alpha', 'beta']);
  });

  test('and works with the sync in place', async () => {
    const runtime = await serverRuntime();
    await runtime.run(async (context) => {
      const first = context.document.body.search('alpha').getFirst();
      await context.sync();
      first.insertText('!', 'End');
      await context.sync();
    });
    expect(await paragraphTexts(runtime)).toEqual(['alpha!', 'beta']);
  });
});

describe('a batch of writes', () => {
  test('commits as one revision, or not at all', async () => {
    const runtime = await serverRuntime(docx(`${p('one')}${p('two')}`));
    await runtime.run(async (context) => {
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load();
      await context.sync();
      paragraphs.items[0]!.insertText('!', 'End');
      paragraphs.items[1]!.insertText('!', 'End');
      await context.sync();
    });
    expect(await paragraphTexts(runtime)).toEqual(['one!', 'two!']);
  });

  test('refuses two changes that both claim one paragraph, and writes neither', async () => {
    const runtime = await serverRuntime(docx(p('anchor')));
    const code = await codeOf(() =>
      runtime.run(async (context) => {
        const paragraph = context.document.body.paragraphs.getFirst();
        await context.sync();
        paragraph.insertParagraph('beside', 'After');
        paragraph.insertText('!', 'End');
        await context.sync();
      })
    );
    expect(code).toBe('ConflictingChanges');
    expect(await paragraphTexts(runtime)).toEqual(['anchor']);
  });

  test('refuses a write that would join paragraphs across a table cell, and writes nothing', async () => {
    // The whole story of this document runs `before`, into a row of two cells, and out again to
    // `after`. Writing over all of it at once would have to join the two cells' paragraphs into
    // one, which the document store refuses — so the whole batch is refused with it.
    const runtime = await serverRuntime(TABLE_DOCUMENT);
    const code = await codeOf(() =>
      runtime.run(async (context) => {
        context.document.body.insertText('flat', 'Replace');
        await context.sync();
      })
    );
    expect(code).toBe('GeneralException');
    expect(await paragraphTexts(runtime)).toEqual(['before', 'in cell', 'other cell', 'after']);
  });

  test('a write from a run whose read is stale is refused rather than applied', async () => {
    const runtime = await serverRuntime(TWO_PARAGRAPHS);
    const kept = await runtime.run(async (context) => {
      const paragraph = context.document.body.paragraphs.getFirst();
      await context.sync();
      paragraph.load('text');
      await context.sync();
      context.trackedObjects.add(paragraph);
      return paragraph;
    });

    // Somebody else moves the document on.
    await runtime.run(async (context) => {
      context.document.body.insertText('!', 'End');
      await context.sync();
    });

    const code = await codeOf(() =>
      runtime.run(kept, async (context) => {
        kept.insertText('?', 'End');
        await context.sync();
      })
    );
    expect(code).toBe('StaleDocument');
  });
});

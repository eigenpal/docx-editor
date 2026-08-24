/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// What the object model can be asked about a document.
//
// Every test here goes through `runtime.run` → `load` → `sync`, because that is the only way a
// consumer reads anything, and the answers have to come from the document rather than from the
// model's own bookkeeping. The fixtures are deliberately awkward — paragraphs inside table cells,
// inside a table inside a cell, a body with no paragraph at all — since those are the shapes where
// a plausible-looking model quietly answers something it made up.

import { describe, expect, test } from 'bun:test';
import { isDocxEditorError } from '../../runtime/errors.ts';
import {
  EMPTY_BODY,
  NESTED_TABLE_DOCUMENT,
  TABLE_DOCUMENT,
  WITH_FURNITURE,
  docx,
  p,
  pWithId,
  serverRuntime,
} from './support/documents.ts';

/** The code of the `DocxEditorError` a call threw, for readable expectations. */
async function codeOf(call: () => Promise<unknown>): Promise<string> {
  try {
    await call();
  } catch (error) {
    if (isDocxEditorError(error)) return error.code;
    throw error;
  }
  throw new Error('the call did not fail');
}

describe('the document and its body', () => {
  test('the body reads as its paragraphs joined by a paragraph mark', async () => {
    const runtime = await serverRuntime();
    const text = await runtime.run(async (context) => {
      const body = context.document.body;
      body.load('text');
      await context.sync();
      return body.text;
    });
    // A carriage return, the separator Word's own text property uses.
    expect(text).toBe('alpha\rbeta');
  });

  test('a body with no paragraph reads as empty text rather than refusing', async () => {
    const runtime = await serverRuntime(EMPTY_BODY);
    const text = await runtime.run(async (context) => {
      const body = context.document.body;
      body.load('text');
      await context.sync();
      return body.text;
    });
    expect(text).toBe('');
  });
});

describe('revision text projections', () => {
  const document = docx(
    '<w:p><w:r><w:t xml:space="preserve">keep </w:t></w:r>' +
      '<w:del w:id="1" w:author="Ada"><w:r><w:delText>gone</w:delText></w:r></w:del>' +
      '<w:ins w:id="2" w:author="Ada"><w:r><w:t>added</w:t></w:r></w:ins></w:p>'
  );

  test('keeps compatibility reads and offers a consistent vanilla read-search-range view', async () => {
    const runtime = await serverRuntime(document);
    const result = await runtime.run(async (context) => {
      const body = context.document.body;
      body.load('text');
      const vanilla = body.getText({ projection: 'vanilla' });
      const found = body.search('gone', { projection: 'vanilla' });
      const inserted = body.search('added', { projection: 'vanilla' });
      found.load('items');
      inserted.load('items');
      await context.sync();

      const range = found.items[0]!;
      range.load('text');
      const explicitRange = range.getText();
      await context.sync();
      const before = {
        compatibility: body.text,
        vanilla: vanilla.value,
        range: range.text,
        explicitRange: explicitRange.value,
        hiddenMatches: inserted.items.length,
      };

      range.insertText('kept', 'Replace');
      await context.sync();
      const after = body.getText({ projection: 'all' });
      await context.sync();
      return { before, after: after.value };
    });

    expect(result).toEqual({
      before: {
        compatibility: 'keep goneadded',
        vanilla: 'keep gone',
        range: 'gone',
        explicitRange: 'gone',
        hiddenMatches: 0,
      },
      after: 'keep keptadded',
    });
  });
});

describe('the paragraphs of a story', () => {
  test('are the paragraphs the document has, in reading order', async () => {
    const runtime = await serverRuntime();
    const texts = await runtime.run(async (context) => {
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load();
      await context.sync();
      for (const paragraph of paragraphs.items) paragraph.load('text');
      await context.sync();
      return paragraphs.items.map((paragraph) => paragraph.text);
    });
    expect(texts).toEqual(['alpha', 'beta']);
  });

  test('include the ones inside table cells, because Word counts those too', async () => {
    const runtime = await serverRuntime(TABLE_DOCUMENT);
    const texts = await runtime.run(async (context) => {
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load();
      await context.sync();
      for (const paragraph of paragraphs.items) paragraph.load('text');
      await context.sync();
      return paragraphs.items.map((paragraph) => paragraph.text);
    });
    expect(texts).toEqual(['before', 'in cell', 'other cell', 'after']);
  });

  test('include the ones inside a table nested in a cell', async () => {
    const runtime = await serverRuntime(NESTED_TABLE_DOCUMENT);
    const texts = await runtime.run(async (context) => {
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load();
      await context.sync();
      for (const paragraph of paragraphs.items) paragraph.load('text');
      await context.sync();
      return paragraphs.items.map((paragraph) => paragraph.text);
    });
    expect(texts).toEqual(['outer', 'deep']);
  });

  test('count an empty paragraph, and it reads as empty text', async () => {
    const runtime = await serverRuntime(docx(`${p('alpha')}${p('')}${p('beta')}`));
    const texts = await runtime.run(async (context) => {
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load();
      await context.sync();
      for (const paragraph of paragraphs.items) paragraph.load('text');
      await context.sync();
      return paragraphs.items.map((paragraph) => paragraph.text);
    });
    expect(texts).toEqual(['alpha', '', 'beta']);
  });

  test('are none at all in a body that holds none', async () => {
    const runtime = await serverRuntime(EMPTY_BODY);
    const count = await runtime.run(async (context) => {
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load();
      await context.sync();
      return paragraphs.items.length;
    });
    expect(count).toBe(0);
  });

  test('can be paged with skip and top', async () => {
    const runtime = await serverRuntime(docx(`${p('a')}${p('b')}${p('c')}${p('d')}`));
    const texts = await runtime.run(async (context) => {
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load({ skip: 1, top: 2 });
      await context.sync();
      for (const paragraph of paragraphs.items) paragraph.load('text');
      await context.sync();
      return paragraphs.items.map((paragraph) => paragraph.text);
    });
    expect(texts).toEqual(['b', 'c']);
  });

  test('are the main story\u2019s only \u2014 not the header\u2019s, the footer\u2019s or a note\u2019s', async () => {
    // The stories exist in the same file and have their own paragraphs. This slice publishes ONE
    // of them, and the failure to avoid is not "the header is missing" but "the header is in the
    // body": a flattened list reports a document nobody can see and then writes into the wrong
    // part. Header, footer and note editing arrive with the chrome that can address them; until
    // then the body is the body.
    const runtime = await serverRuntime(WITH_FURNITURE);
    const [texts, bodyText, elsewhere] = await runtime.run(async (context) => {
      const body = context.document.body;
      body.load('text');
      const paragraphs = body.paragraphs;
      paragraphs.load();
      const header = body.search('in the header');
      const footer = body.search('in the footer');
      const note = body.search('in the footnote');
      header.load();
      footer.load();
      note.load();
      await context.sync();
      for (const paragraph of paragraphs.items) paragraph.load('text');
      await context.sync();
      return [
        paragraphs.items.map((paragraph) => paragraph.text),
        body.text,
        header.items.length + footer.items.length + note.items.length,
      ];
    });
    // The footnote's own text is not here. What IS here is one object-replacement character where
    // the reference sits: the note is an atom that occupies a position, and reading it as nothing
    // would put every offset after it one unit out of step with what a write is validated against.
    expect(texts).toEqual(['in the body\uFFFC']);
    expect(bodyText).toBe('in the body\uFFFC');
    expect(elsewhere).toBe(0);
  });

  test("the document's own paragraphs are the main story's", async () => {
    const runtime = await serverRuntime(TABLE_DOCUMENT);
    const count = await runtime.run(async (context) => {
      const paragraphs = context.document.paragraphs;
      paragraphs.load();
      await context.sync();
      return paragraphs.items.length;
    });
    expect(count).toBe(4);
  });
});

describe('reaching one paragraph of a collection', () => {
  test('the first and the last are the ones the document starts and ends with', async () => {
    const runtime = await serverRuntime();
    const [first, last] = await runtime.run(async (context) => {
      const paragraphs = context.document.body.paragraphs;
      const head = paragraphs.getFirst();
      const tail = paragraphs.getLast();
      await context.sync();
      head.load('text');
      tail.load('text');
      await context.sync();
      return [head.text, tail.text];
    });
    expect([first, last]).toEqual(['alpha', 'beta']);
  });

  test('asking an empty collection for its first item is an error, not an empty object', async () => {
    const runtime = await serverRuntime(EMPTY_BODY);
    const code = await codeOf(() =>
      runtime.run(async (context) => {
        context.document.body.paragraphs.getFirst();
        await context.sync();
      })
    );
    expect(code).toBe('ItemNotFound');
  });
});

describe("a paragraph's identity", () => {
  test("is the document's own, when the file wrote one", async () => {
    const runtime = await serverRuntime(docx(pWithId('alpha', '1A2B3C4D')));
    const id = await runtime.run(async (context) => {
      const paragraph = context.document.body.paragraphs.getFirst();
      await context.sync();
      paragraph.load('uniqueLocalId');
      await context.sync();
      return paragraph.uniqueLocalId;
    });
    expect(id).toBe('1A2B3C4D');
  });

  test('is never an index: it survives the paragraph before it being deleted', async () => {
    const runtime = await serverRuntime();
    const [before, after] = await runtime.run(async (context) => {
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load();
      await context.sync();
      const [head, tail] = paragraphs.items;
      tail!.load('uniqueLocalId');
      await context.sync();
      const first = tail!.uniqueLocalId;

      head!.delete();
      await context.sync();
      tail!.load('uniqueLocalId');
      await context.sync();
      return [first, tail!.uniqueLocalId];
    });
    expect(before).toBe(after);
    expect(before).not.toBe('');
  });

  test('is distinct between paragraphs of one document', async () => {
    const runtime = await serverRuntime();
    const ids = await runtime.run(async (context) => {
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load();
      await context.sync();
      for (const paragraph of paragraphs.items) paragraph.load('uniqueLocalId');
      await context.sync();
      return paragraphs.items.map((paragraph) => paragraph.uniqueLocalId);
    });
    expect(new Set(ids).size).toBe(2);
    for (const id of ids) expect(id).not.toBe('');
  });
});

describe('a range', () => {
  test('reads the text between its endpoints', async () => {
    const runtime = await serverRuntime(docx(p('find me here')));
    const text = await runtime.run(async (context) => {
      const found = context.document.body.search('me');
      found.load();
      await context.sync();
      const range = found.items[0]!;
      range.load('text');
      await context.sync();
      return range.text;
    });
    expect(text).toBe('me');
  });

  test('knows the paragraphs it covers', async () => {
    const runtime = await serverRuntime();
    const texts = await runtime.run(async (context) => {
      const found = context.document.body.search('alpha');
      found.load();
      await context.sync();
      const paragraphs = found.items[0]!.paragraphs;
      paragraphs.load();
      await context.sync();
      for (const paragraph of paragraphs.items) paragraph.load('text');
      await context.sync();
      return paragraphs.items.map((paragraph) => paragraph.text);
    });
    expect(texts).toEqual(['alpha']);
  });

  test('is refused rather than read once its paragraph is gone', async () => {
    const runtime = await serverRuntime();
    const code = await codeOf(() =>
      runtime.run(async (context) => {
        const paragraphs = context.document.body.paragraphs;
        paragraphs.load();
        await context.sync();
        const found = context.document.body.search('alpha');
        found.load();
        await context.sync();

        paragraphs.items[0]!.delete();
        await context.sync();

        found.items[0]!.load('text');
        await context.sync();
      })
    );
    expect(code).toBe('InvalidObjectPath');
  });
});

describe('searching a story', () => {
  test('answers one range per occurrence, in reading order', async () => {
    const runtime = await serverRuntime(docx(`${p('one two one')}${p('one')}`));
    const texts = await runtime.run(async (context) => {
      const found = context.document.body.search('one');
      found.load();
      await context.sync();
      for (const range of found.items) range.load('text');
      await context.sync();
      return found.items.map((range) => range.text);
    });
    expect(texts).toEqual(['one', 'one', 'one']);
  });

  test('finds duplicate text in a table cell as well as in the body', async () => {
    const runtime = await serverRuntime(TABLE_DOCUMENT);
    const count = await runtime.run(async (context) => {
      const found = context.document.body.search('cell');
      found.load();
      await context.sync();
      return found.items.length;
    });
    expect(count).toBe(2);
  });

  test('honours matchCase and matchWholeWord', async () => {
    const runtime = await serverRuntime(docx(p('Cat cat category')));
    const counts = await runtime.run(async (context) => {
      const body = context.document.body;
      const insensitive = body.search('cat');
      const cased = body.search('cat', { matchCase: true });
      const whole = body.search('cat', { matchWholeWord: true });
      insensitive.load();
      cased.load();
      whole.load();
      await context.sync();
      return [insensitive.items.length, cased.items.length, whole.items.length];
    });
    expect(counts).toEqual([3, 2, 2]);
  });

  test('refuses an option it cannot honour instead of ignoring it', async () => {
    const runtime = await serverRuntime();
    const code = await codeOf(() =>
      runtime.run(async (context) => {
        const found = context.document.body.search('alpha', { matchWildcards: true });
        found.load();
        await context.sync();
      })
    );
    expect(code).toBe('NotSupported');
  });

  test('refuses a narrowing this API does not have, naming it', async () => {
    // Word narrows a search in more ways than this subset selects. Dropping one silently would
    // answer matches the caller did not ask for, at offsets they would then write to.
    const runtime = await serverRuntime();
    const code = await codeOf(() =>
      runtime.run(async (context) => {
        const body = context.document.body as unknown as {
          search(text: string, options: Record<string, boolean>): unknown;
        };
        body.search('alpha', { matchPrefix: true });
      })
    );
    expect(code).toBe('InvalidArgument');
  });

  test('refuses an empty query rather than answering that it matches everywhere', async () => {
    const runtime = await serverRuntime();
    const code = await codeOf(() =>
      runtime.run(async (context) => {
        const found = context.document.body.search('');
        found.load();
        await context.sync();
      })
    );
    expect(code).toBe('InvalidArgument');
  });

  test('stops at the engine result cap rather than one entry per character', async () => {
    const runtime = await serverRuntime(docx(p('x'.repeat(5000))));
    const count = await runtime.run(async (context) => {
      const found = context.document.body.search('x');
      found.load();
      await context.sync();
      return found.items.length;
    });
    expect(count).toBe(2000);
  });

  test('a search inside a range only looks there', async () => {
    // `one` occurs three times in the story and twice inside the range that starts at the second
    // one. Searching the range answers about the range, not about the document around it.
    const runtime = await serverRuntime(docx(p('one two one three one')));
    const counts = await runtime.run(async (context) => {
      const body = context.document.body;
      const whole = body.search('two one three');
      whole.load();
      const everywhere = body.search('one');
      everywhere.load();
      await context.sync();

      const scoped = whole.items[0]!.search('one');
      scoped.load();
      await context.sync();
      return [everywhere.items.length, scoped.items.length];
    });
    expect(counts).toEqual([3, 1]);
  });

  test('offsets are UTF-16 units, so an astral character counts as two', async () => {
    const runtime = await serverRuntime(docx(p('a\u{1F600}needle')));
    const text = await runtime.run(async (context) => {
      const found = context.document.body.search('needle');
      found.load();
      await context.sync();
      const range = found.items[0]!;
      range.load('text');
      await context.sync();
      return range.text;
    });
    expect(text).toBe('needle');
  });

  test('an empty collection refuses getFirst rather than answering an empty range', async () => {
    const runtime = await serverRuntime();
    const code = await codeOf(() =>
      runtime.run(async (context) => {
        context.document.body.search('nowhere').getFirst();
        await context.sync();
      })
    );
    expect(code).toBe('ItemNotFound');
  });
});

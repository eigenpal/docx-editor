/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Range.insertBookmark, Range.getBookmarks, Document.deleteBookmark, Document.getBookmarkRange,
// Document.getBookmarkRangeOrNullObject and Bookmark.delete, against a server runtime, with a
// save and reopen where the document's shape changed.

import { describe, expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import { isDocxEditorError } from '../../runtime/errors.ts';
import { DocxEditor } from '../../index.ts';
import type { DocxEditorServerRuntime } from '../../runtime/runtime.ts';
import {
  WITH_BOOKMARKED_STORIES,
  docx,
  mainXmlOf,
  p,
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

// Every character is unique, so a search names exactly one range.
const SAMPLE = docx(
  '<w:p><w:r><w:t>pqrs</w:t></w:r><w:bookmarkStart w:id="1" w:name="rng"/>' +
    '<w:r><w:t>tuv</w:t></w:r><w:bookmarkEnd w:id="1"/><w:r><w:t>wxyz</w:t></w:r>' +
    '<w:bookmarkStart w:id="2" w:name="pt"/><w:bookmarkEnd w:id="2"/>' +
    '<w:bookmarkStart w:id="3" w:name="_hid"/><w:r><w:t>ABC</w:t></w:r><w:bookmarkEnd w:id="3"/></w:p>'
);
const TEXT = 'pqrstuvwxyzABC';

/** The names `getBookmarks` answers for offsets `start`..`end` of the first paragraph. */
async function namesIn(
  runtime: DocxEditorServerRuntime,
  start: number,
  end: number,
  includeHidden?: boolean,
  includeAdjacent?: boolean
): Promise<string[]> {
  return runtime.run(async (context) => {
    const found = context.document.body.search(TEXT.slice(start, end), {
      matchCase: true,
    });
    found.load('items');
    await context.sync();
    const names = found.items[0]!.getBookmarks(includeHidden, includeAdjacent);
    await context.sync();
    return names.value;
  });
}

describe('Range.getBookmarks', () => {
  test('answers bookmarks that share text, point bookmarks inside, and only those', async () => {
    const runtime = await serverRuntime(SAMPLE);
    expect(await namesIn(runtime, 4, 7)).toEqual(['rng']);
    expect(await namesIn(runtime, 5, 6)).toEqual(['rng']);
    expect(await namesIn(runtime, 0, 4)).toEqual([]);
    expect(await namesIn(runtime, 7, 9)).toEqual([]);
    expect(await namesIn(runtime, 10, 12)).toEqual(['pt']);
    expect(await namesIn(runtime, 9, 11)).toEqual([]);
  });

  test('adds adjacent bookmarks and hidden ones on request', async () => {
    const runtime = await serverRuntime(SAMPLE);
    expect(await namesIn(runtime, 0, 4, false, true)).toEqual(['rng']);
    expect(await namesIn(runtime, 9, 11, false, true)).toEqual(['pt']);
    expect(await namesIn(runtime, 11, 14)).toEqual(['pt']);
    expect(await namesIn(runtime, 11, 14, true)).toEqual(['pt', '_hid']);
  });

  test('an empty range answers the bookmark that starts there', async () => {
    const runtime = await serverRuntime(
      docx(
        '<w:p><w:bookmarkStart w:id="1" w:name="lead"/><w:r><w:t>Lead</w:t></w:r>' +
          '<w:bookmarkEnd w:id="1"/></w:p>'
      )
    );
    const names = await runtime.run(async (context) => {
      const result = context.document.body.getRange('Start').getBookmarks();
      await context.sync();
      return result.value;
    });
    expect(names).toEqual(['lead']);
  });

  test('refuses non-boolean flags', async () => {
    const runtime = await serverRuntime(SAMPLE);
    expect(
      await codeOf(() =>
        runtime.run(async (context) => {
          const range = context.document.body.getRange('Whole');
          (range.getBookmarks as (hidden: unknown) => unknown)('yes');
          await context.sync();
        })
      )
    ).toBe('InvalidArgument');
  });
});

describe('Range.insertBookmark', () => {
  test('bookmarks a range, survives save and reopen, and moves a same-name bookmark', async () => {
    const runtime = await serverRuntime(docx(p('Hello world')));
    await runtime.run(async (context) => {
      const found = context.document.body.search('world');
      found.load('items');
      await context.sync();
      found.items[0]!.insertBookmark('Greeting');
      await context.sync();
    });
    const reopened = await reopen(runtime);
    const text = await reopened.run(async (context) => {
      const range = context.document.getBookmarkRange('greeting');
      range.load('text');
      await context.sync();
      return range.text;
    });
    expect(text).toBe('world');
    await reopened.run(async (context) => {
      const found = context.document.body.search('Hello');
      found.load('items');
      await context.sync();
      found.items[0]!.insertBookmark('GREETING');
      await context.sync();
    });
    const xml = await mainXmlOf(reopened);
    expect(xml.match(/w:bookmarkStart/g)).toHaveLength(1);
    expect(xml).toContain('w:name="GREETING"');
  });

  test('adds a hidden bookmark with an underscore name', async () => {
    const runtime = await serverRuntime(docx(p('Hello')));
    await runtime.run(async (context) => {
      context.document.body.getRange('Start').insertBookmark('_Ref1');
      await context.sync();
    });
    expect(await mainXmlOf(runtime)).toContain('w:name="_Ref1"');
  });

  test('refuses invalid names without writing', async () => {
    const runtime = await serverRuntime(docx(p('Hello')));
    for (const name of ['1st', 'two words', 'a-b', 'x'.repeat(41), '']) {
      expect(
        await codeOf(() =>
          runtime.run(async (context) => {
            context.document.body.getRange('Whole').insertBookmark(name);
            await context.sync();
          })
        )
      ).toBe('InvalidArgument');
    }
    expect(await mainXmlOf(runtime)).not.toContain('bookmarkStart');
  });

  test('a bad name fails the sync, not the call, and the batch writes nothing', async () => {
    const runtime = await serverRuntime(docx(p('Hello')));
    const queued: string[] = [];
    const code = await codeOf(() =>
      runtime.run(async (context) => {
        const range = context.document.body.getRange('Whole');
        range.insertBookmark('Good');
        range.insertBookmark('');
        (context.document.deleteBookmark as (name: unknown) => void)(7);
        queued.push('queued');
        await context.sync();
      })
    );
    expect(queued).toEqual(['queued']);
    expect(code).toBe('InvalidArgument');
    expect(await mainXmlOf(runtime)).not.toContain('bookmarkStart');
  });

  test('moves a name another story declares, in the same sync', async () => {
    const runtime = await serverRuntime(WITH_BOOKMARKED_STORIES);
    await runtime.run(async (context) => {
      const sections = context.document.sections;
      sections.load('items');
      await context.sync();
      const header = sections.items[0]!.getHeader('Primary');
      await context.sync();
      const found = header.search('header');
      found.load('items');
      await context.sync();
      found.items[0]!.insertBookmark('first');
      // A missing name changes nothing and does not stop the header write.
      context.document.deleteBookmark('Missing');
      await context.sync();
    });
    const reopened = await reopen(runtime);
    expect(await mainXmlOf(reopened)).not.toContain('w:name="First"');
    const headerNames = await reopened.run(async (context) => {
      const sections = context.document.sections;
      sections.load('items');
      await context.sync();
      const header = sections.items[0]!.getHeader('Primary');
      await context.sync();
      const bookmarks = header.bookmarks;
      bookmarks.load('items');
      await context.sync();
      for (const bookmark of bookmarks.items) bookmark.load('name');
      await context.sync();
      return bookmarks.items.map((bookmark) => bookmark.name);
    });
    expect(headerNames).toContain('first');
  });

  test('replacing a bookmark range removes the bookmark with its text', async () => {
    const runtime = await serverRuntime(SAMPLE);
    await runtime.run(async (context) => {
      context.document.getBookmarkRange('rng').insertText('ZZ', 'Replace');
      await context.sync();
    });
    const xml = await mainXmlOf(runtime);
    expect(xml).toContain('ZZ');
    expect(xml).not.toContain('w:name="rng"');
  });

  test('writes directly with TrackMineOnly: a bookmark is not a revision', async () => {
    const runtime = await DocxEditor.createServer(docx(p('Hello')), { author: 'Agent' });
    await runtime.run(async (context) => {
      context.document.changeTrackingMode = 'TrackMineOnly';
      context.document.body.getRange('Whole').insertBookmark('Tracked');
      await context.sync();
    });
    const xml = await mainXmlOf(runtime);
    expect(xml).toContain('w:name="Tracked"');
    expect(xml).not.toContain('<w:ins');
  });

  test('moves a name from another story with TrackMineOnly, still without a revision', async () => {
    const runtime = await DocxEditor.createServer(WITH_BOOKMARKED_STORIES, { author: 'Agent' });
    await runtime.run(async (context) => {
      context.document.changeTrackingMode = 'TrackMineOnly';
      const sections = context.document.sections;
      sections.load('items');
      await context.sync();
      const header = sections.items[0]!.getHeader('Primary');
      await context.sync();
      const found = header.search('header');
      found.load('items');
      await context.sync();
      found.items[0]!.insertBookmark('first');
      await context.sync();
    });
    const xml = await mainXmlOf(runtime);
    expect(xml).not.toContain('w:name="First"');
    expect(xml).not.toContain('<w:del');
  });
});

describe('Document bookmarks by name', () => {
  test('getBookmarkRange reads the body before headers, and a missing name is ItemNotFound', async () => {
    const runtime = await serverRuntime(WITH_BOOKMARKED_STORIES);
    const text = await runtime.run(async (context) => {
      const range = context.document.getBookmarkRange('duplicate');
      range.load('text');
      await context.sync();
      return range.text;
    });
    expect(text).toBe('kept');
    expect(
      await codeOf(() =>
        runtime.run(async (context) => {
          context.document.getBookmarkRange('Missing');
          await context.sync();
        })
      )
    ).toBe('ItemNotFound');
    const isNull = await runtime.run(async (context) => {
      const range = context.document.getBookmarkRangeOrNullObject('Missing');
      await context.sync();
      return range.isNullObject;
    });
    expect(isNull).toBe(true);
  });

  test('deleteBookmark removes the markers, keeps the text, and ignores a missing name', async () => {
    const runtime = await serverRuntime(SAMPLE);
    await runtime.run(async (context) => {
      context.document.deleteBookmark('RNG');
      context.document.deleteBookmark('Missing');
      await context.sync();
    });
    const xml = await mainXmlOf(await reopen(runtime));
    expect(xml).not.toContain('w:name="rng"');
    expect(xml).toContain('tuv');
    expect(xml).toContain('w:name="pt"');
  });

  test('deleteBookmark shares a sync with an edit in another story, in either order', async () => {
    for (const deleteFirst of [true, false]) {
      const runtime = await serverRuntime(WITH_BOOKMARKED_STORIES);
      await runtime.run(async (context) => {
        const sections = context.document.sections;
        sections.load('items');
        await context.sync();
        const header = sections.items[0]!.getHeader('Primary');
        await context.sync();
        const found = header.search('header');
        found.load('items');
        await context.sync();
        if (deleteFirst) context.document.deleteBookmark('first');
        found.items[0]!.insertText(' line', 'End');
        if (!deleteFirst) context.document.deleteBookmark('first');
        await context.sync();
      });
      const parts = unzipSync(await runtime.save());
      const main = strFromU8(parts['word/document.xml'] as Uint8Array);
      const header = strFromU8(parts['word/header1.xml'] as Uint8Array);
      expect(main).not.toContain('w:name="First"');
      expect(main).toContain('>first<');
      expect(header).toContain(' line');
      expect(header).toContain('w:name="Duplicate"');
    }
  });

  test('Bookmark.delete removes the bookmark a collection named', async () => {
    const runtime = await serverRuntime(SAMPLE);
    await runtime.run(async (context) => {
      const bookmarks = context.document.body.bookmarks;
      bookmarks.load('items');
      await context.sync();
      bookmarks.items[0]!.delete();
      await context.sync();
    });
    expect(await mainXmlOf(runtime)).not.toContain('w:name="rng"');
  });
});

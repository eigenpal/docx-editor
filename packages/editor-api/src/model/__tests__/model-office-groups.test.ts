/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The objects a source-compatible script reaches for beyond text: lists, links, bookmarks,
// sections, notes, comments and tracked changes.
//
// Through the PUBLIC API and against real bytes, which is the point: the operations behind these are
// tested in the engine, and what is left to get wrong is the projection — a collection that sends
// the wrong listing, a property that hydrates the wrong shape, an object whose address is its
// owner's when it should be its own. Each test here is a script somebody would actually write.

import { describe, expect, test } from 'bun:test';
import { createServer } from '../../runtime/server.ts';
import { isDocxEditorError } from '../../runtime/errors.ts';
import {
  docx,
  p,
  reopen,
  serverRuntime,
  WITH_BOOKMARKED_STORIES,
  WITH_FURNITURE,
  WITH_NOTE_TEXT_CASES,
  WITH_REVIEW_DATE_CASES,
} from './support/documents.ts';

const numbered = (text: string, numId: string, level = 0): string =>
  `<w:p><w:pPr><w:numPr><w:ilvl w:val="${String(level)}"/><w:numId w:val="${numId}"/></w:numPr></w:pPr>` +
  `<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

const LIST_DOCUMENT = docx(
  numbered('first', '3') + numbered('second', '3') + '<w:p><w:r><w:t>prose</w:t></w:r></w:p>'
);

const BOOKMARKED = docx(
  '<w:p><w:bookmarkStart w:id="1" w:name="Target"/><w:r><w:t>marked</w:t></w:r>' +
    '<w:bookmarkEnd w:id="1"/><w:r><w:t xml:space="preserve"> and more</w:t></w:r></w:p>'
);

const TRACKED = docx(
  '<w:p><w:ins w:id="10" w:author="Ada" w:date="2026-02-01T09:00:00Z">' +
    '<w:r><w:t>added</w:t></w:r></w:ins></w:p>'
);

const TRACKED_WITH_UNSUPPORTED_ROW = docx(
  '<w:p><w:ins w:id="10" w:author="Ada"><w:r><w:t>added</w:t></w:r></w:ins></w:p>' +
    '<w:tbl><w:tr><w:trPr><w:ins w:id="20" w:author="Grace"/></w:trPr>' +
    '<w:tc><w:p><w:r><w:t>cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'
);

async function codeOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    return isDocxEditorError(error) ? error.code : 'unknown';
  }
  return 'no-error';
}

describe('lists are the numbers a document puts in front of paragraphs', () => {
  test('a story answers its lists, and a list answers its number and its items', async () => {
    const runtime = await serverRuntime(LIST_DOCUMENT);
    const found = await runtime.run(async (context) => {
      const lists = context.document.body.lists;
      lists.load('items');
      await context.sync();
      const first = lists.items[0]!;
      first.load('id');
      const paragraphs = first.paragraphs;
      paragraphs.load('items');
      await context.sync();
      const texts = paragraphs.items.map((paragraph) => {
        paragraph.load('text');
        return paragraph;
      });
      await context.sync();
      return { count: lists.items.length, id: first.id, texts: texts.map((each) => each.text) };
    });
    expect(found).toEqual({ count: 1, id: 3, texts: ['first', 'second'] });
  });

  test('a paragraph says where it sits in its list, and a plain one refuses the question', async () => {
    const runtime = await serverRuntime(LIST_DOCUMENT);
    const level = await runtime.run(async (context) => {
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load('items');
      await context.sync();
      const item = paragraphs.items[0]!.listItem;
      item.load('level');
      // The list itself is named by a read, so it is an object the NEXT batch can address — the
      // same rule as every object a batch produces in this runtime.
      const list = paragraphs.items[0]!.list;
      await context.sync();
      list.load('id');
      await context.sync();
      return { level: item.level, id: list.id };
    });
    expect(level).toEqual({ level: 0, id: 3 });

    // A paragraph in no list has no list, and says so rather than answering an empty one.
    const code = await codeOf(async () =>
      runtime.run(async (context) => {
        const paragraphs = context.document.body.paragraphs;
        paragraphs.load('items');
        await context.sync();
        void paragraphs.items[2]!.list;
        await context.sync();
      })
    );
    expect(code).toBe('InvalidArgument');
  });

  test('a list takes a new item, and demoting one survives a save', async () => {
    const runtime = await serverRuntime(LIST_DOCUMENT);
    await runtime.run(async (context) => {
      const lists = context.document.body.lists;
      lists.load('items');
      await context.sync();
      lists.items[0]!.insertParagraph('third', 'End');
      await context.sync();
    });
    await runtime.run(async (context) => {
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load('items');
      await context.sync();
      paragraphs.items[1]!.listItem.level = 1;
      await context.sync();
    });
    const next = await reopen(runtime);
    const found = await next.run(async (context) => {
      const lists = context.document.body.lists;
      lists.load('items');
      await context.sync();
      const paragraphs = lists.items[0]!.getLevelParagraphs(0);
      paragraphs.load('items');
      await context.sync();
      const loaded = paragraphs.items.map((paragraph) => {
        paragraph.load('text');
        return paragraph;
      });
      await context.sync();
      return loaded.map((each) => each.text);
    });
    // 'second' left level 0 and 'third' joined the list, so the top level reads first and third.
    expect(found).toEqual(['first', 'third']);
  });
});

describe('links and bookmarks are the names a document gives to its own text', () => {
  test('a range takes a hyperlink, reads it back, and unlinks when it is cleared', async () => {
    const runtime = await serverRuntime(BOOKMARKED);
    await runtime.run(async (context) => {
      const found = context.document.body.search('marked');
      found.load('items');
      await context.sync();
      found.items[0]!.hyperlink = 'https://example.com/report';
      await context.sync();
    });
    const next = await reopen(runtime);
    const target = await next.run(async (context) => {
      const found = context.document.body.search('marked');
      found.load('items');
      await context.sync();
      const range = found.items[0]!;
      range.load('hyperlink');
      await context.sync();
      return range.hyperlink;
    });
    expect(target).toBe('https://example.com/report');
  });

  test('a scheme the engine would not open is refused rather than written', async () => {
    const runtime = await serverRuntime(BOOKMARKED);
    const code = await codeOf(async () =>
      runtime.run(async (context) => {
        const found = context.document.body.search('marked');
        found.load('items');
        await context.sync();
        found.items[0]!.hyperlink = 'javascript:alert(1)';
        await context.sync();
      })
    );
    // `InvalidArgument`: the URL was refused while the batch was being planned, so nothing about the
    // document was attempted and the failure is about the argument rather than about a transaction.
    expect(code).toBe('InvalidArgument');
  });

  test('a bookmark answers its name and the words it encloses', async () => {
    const runtime = await serverRuntime(BOOKMARKED);
    const found = await runtime.run(async (context) => {
      const whole = context.document.body.search('marked and more');
      whole.load('items');
      await context.sync();
      const bookmarks = whole.items[0]!.bookmarks;
      bookmarks.load('items');
      await context.sync();
      const bookmark = bookmarks.items[0]!;
      bookmark.load('name');
      const range = bookmark.range;
      await context.sync();
      range.load('text');
      await context.sync();
      return { name: bookmark.name, text: range.text };
    });
    expect(found).toEqual({ name: 'Target', text: 'marked' });
  });

  test('a body enumerates an empty bookmark collection without searchable text', async () => {
    const runtime = await serverRuntime(docx(p('plain')));
    const found = await runtime.run(async (context) => {
      const bookmarks = context.document.body.bookmarks;
      bookmarks.load('items');
      await context.sync();
      return bookmarks.items;
    });
    expect(found).toEqual([]);
  });

  test('a body enumerates multiple bookmarks, keeps the first duplicate, and applies load queries', async () => {
    const runtime = await serverRuntime(WITH_BOOKMARKED_STORIES);
    const found = await runtime.run(async (context) => {
      const body = context.document.body;
      const bookmarks = body.bookmarks;
      expect(body.bookmarks).toBe(bookmarks);
      bookmarks.load('items');
      await context.sync();

      const all = [...bookmarks.items];
      for (const bookmark of all) bookmark.load('name');
      await context.sync();
      const duplicate = all[1]!;
      const range = duplicate.range;
      await context.sync();
      range.load('text');
      await context.sync();

      bookmarks.load({ select: 'items', skip: 1, top: 1 });
      await context.sync();
      const filtered = bookmarks.items[0]!;
      filtered.load('name');
      await context.sync();
      return {
        names: all.map((bookmark) => bookmark.name),
        duplicateText: range.text,
        filtered: filtered.name,
      };
    });
    expect(found).toEqual({
      names: ['First', 'Duplicate'],
      duplicateText: 'kept',
      filtered: 'Duplicate',
    });
  });

  test('each body enumerates only the bookmarks in its own story', async () => {
    const runtime = await serverRuntime(WITH_BOOKMARKED_STORIES);
    const found = await runtime.run(async (context) => {
      const main = context.document.body.bookmarks;
      const sections = context.document.sections;
      main.load('items');
      sections.load('items');
      await context.sync();

      const header = sections.items[0]!.getHeader('Primary');
      await context.sync();
      const headerBookmarks = header.bookmarks;
      headerBookmarks.load('items');
      await context.sync();

      for (const bookmark of [...main.items, ...headerBookmarks.items]) bookmark.load('name');
      await context.sync();
      return {
        main: main.items.map((bookmark) => bookmark.name),
        header: headerBookmarks.items.map((bookmark) => bookmark.name),
      };
    });
    expect(found).toEqual({ main: ['First', 'Duplicate'], header: ['Duplicate'] });
  });

  test('selecting a bookmark without a reader is refused at the call', async () => {
    const runtime = await serverRuntime(BOOKMARKED);
    const code = await codeOf(async () =>
      runtime.run(async (context) => {
        const whole = context.document.body.search('marked');
        whole.load('items');
        await context.sync();
        const bookmarks = whole.items[0]!.bookmarks;
        bookmarks.load('items');
        await context.sync();
        bookmarks.items[0]!.select();
      })
    );
    expect(code).toBe('NotSupported');
  });
});

describe('a section is the page a story is laid out on', () => {
  test('a document answers its sections, their page setup, and their furniture', async () => {
    const runtime = await createServer(WITH_FURNITURE);
    const found = await runtime.run(async (context) => {
      const sections = context.document.sections;
      sections.load('items');
      await context.sync();
      const section = sections.items[0]!;
      const setup = section.pageSetup;
      setup.load(['pageWidth', 'pageHeight', 'orientation']);
      // The header is a story a read NAMES, so it is addressable from the next batch on.
      const header = section.getHeader('Primary');
      await context.sync();
      header.load('text');
      await context.sync();
      return {
        count: sections.items.length,
        width: Math.round(setup.pageWidth),
        orientation: setup.orientation,
        header: header.text,
      };
    });
    // 11906 twips is A4 across, which is 595 points.
    expect(found).toEqual({
      count: 1,
      width: 595,
      orientation: 'Portrait',
      header: 'in the header',
    });
  });

  test('a margin written on a section survives a save and reopen', async () => {
    const runtime = await createServer(WITH_FURNITURE);
    await runtime.run(async (context) => {
      const sections = context.document.sections;
      sections.load('items');
      await context.sync();
      sections.items[0]!.pageSetup.topMargin = 36;
      await context.sync();
    });
    const next = await reopen(runtime);
    const margin = await next.run(async (context) => {
      const sections = context.document.sections;
      sections.load('items');
      await context.sync();
      const setup = sections.items[0]!.pageSetup;
      setup.load('topMargin');
      await context.sync();
      return setup.topMargin;
    });
    expect(margin).toBe(36);
  });

  test('a footnote is a story of its own, and its body reads its own text', async () => {
    const runtime = await createServer(WITH_FURNITURE);
    const found = await runtime.run(async (context) => {
      const notes = context.document.footnotes;
      notes.load('items');
      await context.sync();
      const note = notes.items[0]!;
      note.load('type');
      const body = note.body;
      await context.sync();
      body.load('text');
      await context.sync();
      return { type: note.type, text: body.text, count: notes.items.length };
    });
    expect(found).toEqual({ type: 'Footnote', text: 'in the footnote', count: 1 });
  });

  test('note text is unloaded until one post-listing load round fills every item', async () => {
    const runtime = await createServer(WITH_NOTE_TEXT_CASES);
    const found = await runtime.run(async (context) => {
      const footnotes = context.document.footnotes;
      const endnotes = context.document.endnotes;
      footnotes.load();
      endnotes.load();
      await context.sync();

      const notes = [...footnotes.items, ...endnotes.items];
      for (const note of notes) {
        expect(() => note.text).toThrowError(
          expect.objectContaining({
            code: 'PropertyNotLoaded',
            target: expect.stringContaining('.text'),
          })
        );
        note.load(['text', 'type']);
      }
      await context.sync();
      return notes.map((note) => ({ type: note.type, text: note.text }));
    });
    expect(found).toEqual([
      { type: 'Footnote', text: '' },
      { type: 'Footnote', text: 'first\t<unsafe>\nline\rsecond' },
      { type: 'Endnote', text: 'end note' },
    ]);
  });

  test('direct note text is exactly the note body text', async () => {
    const runtime = await createServer(WITH_NOTE_TEXT_CASES);
    const found = await runtime.run(async (context) => {
      const notes = context.document.footnotes;
      notes.load();
      await context.sync();

      for (const note of notes.items) {
        note.load('text');
        void note.body;
      }
      await context.sync();
      for (const note of notes.items) note.body.load('text');
      await context.sync();
      return notes.items.map((note) => [note.text, note.body.text]);
    });
    expect(found).toEqual([
      ['', ''],
      ['first\t<unsafe>\nline\rsecond', 'first\t<unsafe>\nline\rsecond'],
    ]);
  });

  test('a note revision collection accepts its own story rather than the main body', async () => {
    const runtime = await createServer(WITH_NOTE_TEXT_CASES);
    await runtime.run(async (context) => {
      const notes = context.document.endnotes;
      notes.load('items');
      await context.sync();
      const body = notes.items[0]!.body;
      await context.sync();
      const revisions = body.revisions;
      revisions.load('items');
      await context.sync();
      expect(revisions.items).toHaveLength(1);
      revisions.acceptAll();
      await context.sync();
    });

    const next = await reopen(runtime);
    const remaining = await next.run(async (context) => {
      const notes = context.document.endnotes;
      notes.load('items');
      await context.sync();
      const body = notes.items[0]!.body;
      await context.sync();
      const revisions = body.revisions;
      revisions.load('items');
      await context.sync();
      return revisions.items.length;
    });
    expect(remaining).toBe(0);
  });

  test('a deleted note refuses a later direct text load', async () => {
    const runtime = await createServer(WITH_NOTE_TEXT_CASES);
    const code = await codeOf(() =>
      runtime.run(async (context) => {
        const notes = context.document.footnotes;
        notes.load();
        await context.sync();
        const note = notes.items[0]!;
        note.delete();
        await context.sync();
        note.load('text');
        await context.sync();
      })
    );
    expect(code).toBe('InvalidObjectPath');
  });
});

describe('comments and tracked changes are what a document says about itself', () => {
  test('review dates preserve valid stamps and null absent or invalid OOXML values', async () => {
    const runtime = await serverRuntime(WITH_REVIEW_DATE_CASES);
    const dates = await runtime.run(async (context) => {
      const comments = context.document.comments;
      const revisions = context.document.revisions;
      comments.load('items');
      revisions.load('items');
      await context.sync();

      for (const comment of comments.items) {
        comment.load('creationDate');
        comment.replies.load('items');
      }
      for (const revision of revisions.items) revision.load('date');
      await context.sync();

      for (const comment of comments.items) {
        for (const reply of comment.replies.items) reply.load('creationDate');
      }
      await context.sync();

      return {
        comments: comments.items.map((comment) => comment.creationDate),
        replies: comments.items.map((comment) => comment.replies.items[0]!.creationDate),
        revisions: revisions.items.map((revision) => revision.date),
      };
    });

    expect(dates.comments).toEqual([new Date('2026-01-01T10:00:00Z'), null, null]);
    expect(dates.replies).toEqual([new Date('2026-01-02T10:00:00Z'), null, null]);
    expect(dates.revisions).toEqual([new Date('2026-03-01T10:00:00Z'), null, null]);
  });

  test('deleting a reply removes only that reply and makes its proxy stale', async () => {
    const runtime = await serverRuntime(WITH_REVIEW_DATE_CASES);
    const stale = await runtime.run(async (context) => {
      const comments = context.document.comments;
      comments.load('items');
      await context.sync();
      const root = comments.items[0]!;
      root.replies.load('items');
      await context.sync();
      const reply = root.replies.items[0]!;
      reply.delete();
      await context.sync();
      return reply;
    });

    const remaining = await runtime.run(async (context) => {
      const comments = context.document.comments;
      comments.load('items');
      await context.sync();
      comments.items[0]!.replies.load('items');
      await context.sync();
      return { roots: comments.items.length, replies: comments.items[0]!.replies.items.length };
    });
    expect(remaining).toEqual({ roots: 3, replies: 0 });
    await expect(
      runtime.run(stale, async (context) => {
        stale.load('id');
        await context.sync();
      })
    ).rejects.toMatchObject({ code: 'InvalidObjectPath' });
  });

  test('deleting roots is batched atomically and removes their threads', async () => {
    const runtime = await serverRuntime(WITH_REVIEW_DATE_CASES);
    await runtime.run(async (context) => {
      const comments = context.document.comments;
      comments.load('items');
      await context.sync();
      comments.items[0]!.delete();
      comments.items[1]!.delete();
      await context.sync();
    });
    const remaining = await runtime.run(async (context) => {
      const comments = context.document.comments;
      comments.load('items');
      await context.sync();
      return comments.items.length;
    });
    expect(remaining).toBe(1);
  });

  test('a tracked insertion is a decision a script can read and accept', async () => {
    const runtime = await serverRuntime(TRACKED);
    const before = await runtime.run(async (context) => {
      const revisions = context.document.revisions;
      revisions.load('items');
      await context.sync();
      const revision = revisions.items[0]!;
      revision.load(['author', 'type']);
      await context.sync();
      return { count: revisions.items.length, author: revision.author, type: revision.type };
    });
    expect(before).toEqual({ count: 1, author: 'Ada', type: 'Insert' });

    await runtime.run(async (context) => {
      const revisions = context.document.revisions;
      revisions.load('items');
      await context.sync();
      revisions.items[0]!.accept();
      await context.sync();
    });
    const next = await reopen(runtime);
    const after = await next.run(async (context) => {
      const revisions = context.document.revisions;
      const body = context.document.body;
      revisions.load('items');
      body.load('text');
      await context.sync();
      return { count: revisions.items.length, text: body.text };
    });
    expect(after.count).toBe(0);
    expect(after.text).toContain('added');
  });

  test('accept all reports unsupported structural revisions without changing the story', async () => {
    const runtime = await serverRuntime(TRACKED_WITH_UNSUPPORTED_ROW);
    const code = await codeOf(() =>
      runtime.run(async (context) => {
        context.document.revisions.acceptAll();
        await context.sync();
      })
    );
    expect(code).toBe('NotImplemented');

    const remaining = await runtime.run(async (context) => {
      const revisions = context.document.revisions;
      revisions.load('items');
      await context.sync();
      return revisions.items.length;
    });
    expect(remaining).toBe(1);
  });

  test('a runtime with no author refuses to write a comment rather than inventing one', async () => {
    const runtime = await serverRuntime(docx(p('target')));
    const code = await codeOf(async () =>
      runtime.run(async (context) => {
        const matches = context.document.body.search('target');
        matches.load('items');
        await context.sync();
        matches.items[0]!.insertComment('needs an author');
      })
    );
    expect(code).toBe('NotSupported');
  });

  test('empty text is invalid, and a range whose paragraph was deleted becomes stale', async () => {
    const runtime = await createServer(docx(p('target') + p('survivor')), { author: 'Reviewer' });
    const empty = await codeOf(async () =>
      runtime.run(async (context) => {
        const matches = context.document.body.search('target');
        matches.load('items');
        await context.sync();
        matches.items[0]!.insertComment('');
      })
    );
    expect(empty).toBe('InvalidArgument');

    const stale = await codeOf(async () =>
      runtime.run(async (context) => {
        const matches = context.document.body.search('target');
        const paragraphs = context.document.body.paragraphs;
        matches.load('items');
        paragraphs.load('items');
        await context.sync();
        const range = matches.items[0]!;
        paragraphs.items[0]!.delete();
        await context.sync();
        range.insertComment('too late');
        await context.sync();
      })
    );
    expect(stale).toBe('InvalidObjectPath');
  });
});

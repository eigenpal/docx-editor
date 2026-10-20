/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { createRuntime } from '../runtime.ts';
import { openHost } from './support/hosts.ts';
import { commentedDocx, docx, p } from './support/docx.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';

function notesDocx(): Uint8Array {
  const parts = unzipSync(
    docx(
      '<w:p><w:r><w:t>Terms</w:t><w:footnoteReference w:id="1"/><w:endnoteReference w:id="1"/><w:endnoteReference w:id="2"/></w:r></w:p>'
    )
  );
  parts['[Content_Types].xml'] = strToU8(
    strFromU8(parts['[Content_Types].xml']!).replace(
      '</Types>',
      '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>' +
        '<Override PartName="/word/endnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.endnotes+xml"/></Types>'
    )
  );
  parts['word/_rels/document.xml.rels'] = strToU8(
    `<Relationships xmlns="${REL}"><Relationship Id="f" Type="${OD}footnotes" Target="footnotes.xml"/><Relationship Id="e" Type="${OD}endnotes" Target="endnotes.xml"/></Relationships>`
  );
  parts['word/footnotes.xml'] = strToU8(
    `<w:footnotes xmlns:w="${W}"><w:footnote w:id="1">${p('Footnote text')}</w:footnote></w:footnotes>`
  );
  parts['word/endnotes.xml'] = strToU8(
    `<w:endnotes xmlns:w="${W}"><w:endnote w:id="1">${p('First endnote')}</w:endnote><w:endnote w:id="2">${p('Second endnote')}</w:endnote></w:endnotes>`
  );
  return zipSync(parts);
}

test('comment edge properties, range, and reply dependencies resolve in one sync', async () => {
  const runtime = createRuntime({
    host: openHost(commentedDocx()),
    save: true,
    author: 'Reviewer',
  });
  try {
    await runtime.run(async (c) => {
      const first = c.document.comments.getFirst();
      first.load('text,authorName,id,creationDate,resolved');
      const range = first.getRange();
      range.load('text');
      await c.sync();
      expect(first.text).toBe('Is this the right clause?');
      expect(first.authorName).toBe('Ada Lovelace');
      expect(first.id).toBe('7');
      expect(first.creationDate).toBe(null);
      expect(first.resolved).toBe(false);
      expect(range.text).toBe('commented words');
    });
    await runtime.run(async (c) => {
      c.document.comments.getFirst().reply('Approved.');
      await c.sync();
    });
    await runtime.run(async (c) => {
      const reply = c.document.comments.getFirst().replies.getFirst();
      reply.load('text,authorName');
      await c.sync();
      expect(reply.text).toBe('Approved.');
      expect(reply.authorName).toBe('Reviewer');
      c.document.comments.getFirst().resolved = true;
      await c.sync();
    });
    await runtime.run(async (c) => {
      c.document.comments.getFirst().replies.getFirst().delete();
      await c.sync();
      const replies = c.document.comments.getFirst().replies;
      replies.load('items');
      await c.sync();
      expect(replies.items).toHaveLength(0);
      c.document.comments.getFirst().delete();
      await c.sync();
      c.document.comments.load('items');
      await c.sync();
      expect(c.document.comments.items).toHaveLength(0);
    });
  } finally {
    runtime.dispose();
  }
});

test('a created comment remains a write dependency and refuses before commit', async () => {
  const runtime = createRuntime({
    host: openHost(docx(p('original'))),
    save: true,
    author: 'Reviewer',
  });
  try {
    await runtime.run(async (c) => {
      const comment = c.document.body.getRange().insertComment('Not yet committed.');
      comment.load('text');
      await expect(c.sync()).rejects.toMatchObject({ code: 'InvalidObjectPath' });
      c.document.comments.load('items');
      await c.sync();
      expect(c.document.comments.items).toHaveLength(0);
    });
  } finally {
    runtime.dispose();
  }
});

test('note edge properties and body reads resolve without a preliminary sync', async () => {
  const runtime = createRuntime({ host: openHost(notesDocx()), save: true });
  try {
    await runtime.run(async (c) => {
      const footnote = c.document.footnotes.getFirst();
      footnote.load('text,type');
      const body = footnote.body;
      body.load('text');
      const nextEndnote = c.document.endnotes.getFirst().getNext();
      nextEndnote.load('text,type');
      const nextBody = nextEndnote.body;
      nextBody.load('text');
      await c.sync();
      expect(footnote.type).toBe('Footnote');
      expect(footnote.text).toBe('Footnote text');
      expect(body.text).toBe('Footnote text');
      expect(nextEndnote.type).toBe('Endnote');
      expect(nextEndnote.text).toBe('Second endnote');
      expect(nextBody.text).toBe('Second endnote');
      nextEndnote.body.insertText('Edited endnote', 'Replace');
      await c.sync();
      nextEndnote.load('text');
      await c.sync();
      expect(nextEndnote.text).toBe('Edited endnote');
    });
  } finally {
    runtime.dispose();
  }
});

test('bookmark and revision ranges queue their dependent property reads', async () => {
  const runtime = createRuntime({
    host: openHost(
      docx(
        '<w:p><w:bookmarkStart w:id="1" w:name="clause"/><w:r><w:t>original</w:t></w:r><w:bookmarkEnd w:id="1"/></w:p>'
      )
    ),
    save: true,
    author: 'Reviewer',
  });
  try {
    await runtime.run(async (c) => {
      const bookmarks = c.document.body.bookmarks;
      bookmarks.load('items');
      await c.sync();
      const bookmark = bookmarks.items[0]!;
      bookmark.load('name');
      const range = bookmark.range;
      range.load('text');
      await c.sync();
      expect(bookmark.name).toBe('clause');
      expect(range.text).toBe('original');
      c.document.changeTrackingMode = 'TrackMineOnly';
      range.insertText('replacement', 'Replace');
      await c.sync();
      const revisions = c.document.revisions;
      revisions.load('items');
      await c.sync();
      expect(revisions.items.length).toBeGreaterThan(0);
      const revision = revisions.items[0]!;
      revision.load('author,type,date');
      const revisionRange = revision.range;
      revisionRange.load('text');
      await c.sync();
      expect(revision.author).toBe('Reviewer');
      expect(revisionRange.text.length).toBeGreaterThan(0);
    });
  } finally {
    runtime.dispose();
  }
});

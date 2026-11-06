/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The result keeps the comments of both documents: the original's with their ids, the revised
// document's renumbered into the smallest free ids, each anchored where its text lands.
import { expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import { allCases } from '../../../../../scripts/compare-corpus/cases.ts';
import { buildDocx } from '../../../../../scripts/compare-corpus/docx-builder.ts';
import { compareDocuments } from '../index.ts';

function compared(name: string) {
  const entry = allCases().find((item) => item.family === 'review-state' && item.name === name)!;
  const result = compareDocuments(buildDocx(entry.base), buildDocx(entry.revised), {
    authorName: 'Test',
    date: new Date('2026-01-10T12:00:00Z'),
  });
  if (!result.ok) throw new Error(result.message);
  const files = unzipSync(result.bytes);
  const text = (name: string) => (files[name] ? strFromU8(files[name]) : '');
  return { text, files };
}

const commentIds = (xml: string) =>
  [...xml.matchAll(/<w:comment\b[^>]*\bw:id="(\d+)"/g)].map((match) => match[1]);
const markerIds = (xml: string, kind: string) =>
  [...xml.matchAll(new RegExp(`<w:${kind}\\b[^>]*\\bw:id="([^"]+)"`, 'g'))].map((m) => m[1]);

test('comments of both documents are kept and the revised ones renumbered', () => {
  const { text } = compared('comment-both-different');
  const comments = text('word/comments.xml');
  expect(comments).toContain('First view.');
  expect(comments).toContain('Second view.');
  expect(commentIds(comments).sort()).toEqual(['0', '1']);
  const document = text('word/document.xml');
  for (const kind of ['commentRangeStart', 'commentRangeEnd', 'commentReference'])
    expect(markerIds(document, kind).sort()).toEqual(['0', '1']);
  expect(document).not.toContain('§');
});

test('a comment only the revised document has adds a comments part', () => {
  const { text } = compared('comment-revised-only');
  expect(text('word/comments.xml')).toContain('New question.');
  expect(text('word/_rels/document.xml.rels')).toContain('relationships/comments');
  expect(text('[Content_Types].xml')).toContain('/word/comments.xml');
  expect(markerIds(text('word/document.xml'), 'commentReference')).toEqual(['0']);
});

test('a comment only the original has stays as it was', () => {
  const { text } = compared('comment-base-only');
  expect(commentIds(text('word/comments.xml'))).toEqual(['1']);
  expect(markerIds(text('word/document.xml'), 'commentReference')).toEqual(['1']);
});

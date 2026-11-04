/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Content taken from the revised document must keep pointing at the revised document's targets:
// an inserted image at its own bytes, an inserted link at its own address.
import { expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import { allCases } from '../../../../../scripts/compare-corpus/cases.ts';
import { buildDocx } from '../../../../../scripts/compare-corpus/docx-builder.ts';
import { compareDocuments } from '../index.ts';

const DATE = new Date('2026-01-10T12:00:00Z');

function compared(family: string, name: string) {
  const entry = allCases().find((item) => item.family === family && item.name === name)!;
  const base = buildDocx(entry.base);
  const revised = buildDocx(entry.revised);
  const result = compareDocuments(base, revised, { authorName: 'Test', date: DATE });
  if (!result.ok) throw new Error(result.message);
  return { files: unzipSync(result.bytes), revised: unzipSync(revised) };
}

function relationshipTarget(rels: string, id: string): string | undefined {
  return (
    new RegExp(`<Relationship [^>]*Id="${id}"[^>]*Target="([^"]*)"`).exec(rels)?.[1] ??
    new RegExp(`<Relationship [^>]*Target="([^"]*)"[^>]*Id="${id}"`).exec(rels)?.[1]
  );
}

test('a replaced image is inserted with the revised bytes', () => {
  const { files, revised } = compared('drawings', 'image-replace');
  const document = strFromU8(files['word/document.xml']!);
  const rels = strFromU8(files['word/_rels/document.xml.rels']!);
  const inserted = /<w:ins\b[\s\S]*?embed="([^"]+)"/.exec(document)?.[1];
  expect(inserted).toBeDefined();
  const target = relationshipTarget(rels, inserted!);
  expect(target).toBeDefined();
  expect(files[`word/${target}`]).toEqual(revised['word/media/rIdImg1.png']!);
  const deleted = /<w:del\b[\s\S]*?embed="([^"]+)"/.exec(document)?.[1];
  expect(deleted).toBe('rIdImg1');
});

test('a changed link target is inserted with the revised address', () => {
  const { files } = compared('fields', 'hyperlink-target');
  const document = strFromU8(files['word/document.xml']!);
  // Each whole link is a hyperlink field inside its revision: no link element stays behind
  // empty when the revision is accepted or rejected.
  expect(document).not.toContain('<w:hyperlink');
  expect(document).toMatch(
    /<w:ins\b[^>]*>(?:(?!<\/w:ins>).)*<w:instrText[^>]*> HYPERLINK &quot;https:\/\/example\.com\/b&quot; \\h </s
  );
  expect(document).toMatch(
    /<w:del\b[^>]*>(?:(?!<\/w:del>).)*<w:delInstrText[^>]*> HYPERLINK &quot;https:\/\/example\.com\/a&quot; \\h </s
  );
});

test('an image added to a header is copied with a relationship of that header', () => {
  const { files } = compared('headers-footers', 'header-image-add');
  const header = strFromU8(files['word/header1.xml']!);
  const rels = strFromU8(files['word/_rels/header1.xml.rels']!);
  const id = /<w:ins\b[\s\S]*?embed="([^"]+)"/.exec(header)?.[1];
  expect(id).toBeDefined();
  const target = relationshipTarget(rels, id!);
  expect(target).toMatch(/^media\/compare\d+\.png$/);
  expect(files[`word/${target}`]).toBeDefined();
});

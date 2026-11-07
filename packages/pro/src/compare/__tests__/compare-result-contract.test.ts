/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// What a caller of `compareDocuments` relies on: no differences leave the original as it was,
// `changed` tells an untracked change from no change, and bad options refuse instead of
// throwing.
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { readOoxmlPackage, serializeOoxmlPart } from '@docx-editor.dev/core/store';
import { unzipSync } from 'fflate';
import { buildDocx } from '../../../../../scripts/compare-corpus/docx-builder.ts';
import { inlineImage } from '../../../../../scripts/compare-corpus/xml.ts';
import { compareDocuments, type CompareDocumentsOptions } from '../index.ts';

const run = (text: string, rPr = '') =>
  `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}<w:t xml:space="preserve">${text}</w:t></w:r>`;
const docx = (body: string) => buildDocx({ body });
const DATE = new Date('2026-01-10T12:00:00Z');

test('documents with no differences give back the original bytes, unchanged', () => {
  const original = docx(`<w:p>${run('Same text.')}</w:p>`);
  const result = compareDocuments(original, docx(`<w:p>${run('Same text.')}</w:p>`), {
    date: DATE,
  });
  expect(result).toMatchObject({ ok: true, revisionCount: 0, changed: false });
  expect(result.ok && result.bytes).toBe(original);
});

test('a real document compared with itself is unchanged', () => {
  const bytes = new Uint8Array(
    readFileSync(new URL('../../../../../e2e/fixtures/block-sdt-showcase.docx', import.meta.url))
  );
  const result = compareDocuments(bytes, bytes, { date: DATE });
  expect(result).toMatchObject({ ok: true, revisionCount: 0, changed: false });
});

test('untracked formatting differences change the document without revisions', () => {
  const plain = docx(`<w:p>${run('Same text.')}</w:p>`);
  const bold = docx(`<w:p>${run('Same text.', '<w:b/>')}</w:p>`);
  const result = compareDocuments(plain, bold, { date: DATE, detectFormatChanges: false });
  expect(result).toMatchObject({ ok: true, revisionCount: 0, changed: true });
  const tracked = compareDocuments(plain, bold, { date: DATE });
  expect(tracked).toMatchObject({ ok: true, changed: true });
  expect(tracked.ok && tracked.revisionCount).toBeGreaterThan(0);
});

test("the original's own tracked changes are accepted, so the document changes", () => {
  const insertion =
    '<w:ins w:id="1" w:author="A" w:date="2026-01-01T00:00:00Z">' + run(' more') + '</w:ins>';
  const tracked = docx(`<w:p>${run('Text')}${insertion}</w:p>`);
  const accepted = docx(`<w:p>${run('Text')}${run(' more')}</w:p>`);
  const result = compareDocuments(tracked, accepted, { date: DATE });
  expect(result).toMatchObject({ ok: true, revisionCount: 0, changed: true });
});

test('options of the wrong type or an invalid date refuse with invalidOptions', () => {
  const a = docx(`<w:p>${run('A')}</w:p>`);
  const b = docx(`<w:p>${run('B')}</w:p>`);
  const bad: unknown[] = [
    { date: new Date('not a date') },
    { date: '2026-01-01' },
    { detectFormatChanges: 'false' },
    { removeDateAndTime: 1 },
    { authorName: 42 },
  ];
  for (const options of bad) {
    const result = compareDocuments(a, b, options as CompareDocumentsOptions);
    expect(result.ok ? '' : result.code).toBe('invalidOptions');
  }
});

test('a blank author name takes the default author', () => {
  const a = docx(`<w:p>${run('A')}</w:p>`);
  const b = docx(`<w:p>${run('B')}</w:p>`);
  const result = compareDocuments(a, b, { authorName: '  ', date: DATE });
  if (!result.ok) throw new Error(result.message);
  const read = readOoxmlPackage(result.bytes);
  if (!read.ok) throw new Error(read.reason);
  const xml = serializeOoxmlPart(read.package.parts.get(read.package.mainDocumentPart)!);
  // The revised document's last author, as when the option is absent.
  expect(xml).toContain('w:author="Corpus Author"');
  expect(xml).not.toContain('w:author="  "');
});

test('an unchanged picture keeps its part and is not copied', () => {
  const withPicture = (text: string) =>
    buildDocx({
      body: `<w:p><w:r>${inlineImage('rIdImg', 1)}</w:r></w:p><w:p>${run(text)}</w:p>`,
      media: [{ name: 'image1.png', bytes: new Uint8Array([1, 2, 3]), rId: 'rIdImg' }],
    });
  const result = compareDocuments(withPicture('Before'), withPicture('After'), { date: DATE });
  if (!result.ok) throw new Error(result.message);
  expect(result.revisionCount).toBeGreaterThan(0);
  const media = Object.keys(unzipSync(result.bytes)).filter((name) => name.includes('media/'));
  expect(media).toEqual(['word/media/image1.png']);
});

test('a drawing from the revised document never repeats a drawing id of the original', () => {
  const original = buildDocx({
    body: `<w:p>${inlineImage('rIdA', 1)}</w:p><w:p>${run('Text.')}</w:p>`,
    media: [{ name: 'a.png', bytes: new Uint8Array([1, 2, 3]), rId: 'rIdA' }],
  });
  const revised = buildDocx({
    body: `<w:p>${inlineImage('rIdB', 1)}</w:p><w:p>${run('Text.')}${inlineImage('rIdB', 5)}</w:p>`,
    media: [{ name: 'b.png', bytes: new Uint8Array([4, 5, 6]), rId: 'rIdB' }],
  });
  const result = compareDocuments(original, revised, { date: DATE });
  if (!result.ok) throw new Error(result.message);
  const read = readOoxmlPackage(result.bytes);
  if (!read.ok) throw new Error(read.reason);
  const xml = serializeOoxmlPart(read.package.parts.get(read.package.mainDocumentPart)!);
  const ids = [...xml.matchAll(/docPr id="([^"]*)"/g)].map((match) => match[1]);
  // The original's picture keeps its id, so a rejected drawing is the original's again; a
  // revised id the original does not use stays as it is.
  expect(ids.sort()).toEqual(['1', '2', '5']);
});

test('a floating drawing from the revised document never repeats a z-order of the original', () => {
  const floating = (rId: string) =>
    inlineImage(rId, 1)
      .replace(
        '<wp:inline distT="0" distB="0" distL="0" distR="0">',
        '<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="251659264" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>'
      )
      .replace('<wp:docPr', '<wp:wrapNone/><wp:docPr')
      .replace('</wp:inline>', '</wp:anchor>');
  const original = buildDocx({
    body: `<w:p>${floating('rIdA')}${run('Text.')}</w:p>`,
    media: [{ name: 'a.png', bytes: new Uint8Array([1, 2, 3]), rId: 'rIdA' }],
  });
  const revised = buildDocx({
    body: `<w:p>${floating('rIdB')}${run('Text.')}</w:p>`,
    media: [{ name: 'b.png', bytes: new Uint8Array([4, 5, 6]), rId: 'rIdB' }],
  });
  const result = compareDocuments(original, revised, { date: DATE });
  if (!result.ok) throw new Error(result.message);
  const read = readOoxmlPackage(result.bytes);
  if (!read.ok) throw new Error(read.reason);
  const xml = serializeOoxmlPart(read.package.parts.get(read.package.mainDocumentPart)!);
  const orders = [...xml.matchAll(/relativeHeight="([^"]*)"/g)].map((match) => match[1]);
  // The original's drawing keeps its z-order; the new one takes the next free one above it.
  expect(orders.sort()).toEqual(['251659264', '251660288']);
});

/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Object identity is exact (a weak hash collision never hides a changed image), note reference
// attributes take part, ids with any characters survive assembly, and list merges stay linear.
import { expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import { buildDocx } from '../../../../../scripts/compare-corpus/docx-builder.ts';
import { commented, inlineImage, p, r } from '../../../../../scripts/compare-corpus/xml.ts';
import { compareDocuments } from '../index.ts';

const DATE = new Date('2026-01-10T12:00:00Z');

function compared(base: Uint8Array, revised: Uint8Array) {
  const result = compareDocuments(base, revised, { authorName: 'Test', date: DATE });
  if (!result.ok) throw new Error(result.message);
  const files: Record<string, string> = {};
  for (const [name, bytes] of Object.entries(unzipSync(result.bytes)))
    if (!name.includes('media/')) files[name] = strFromU8(bytes);
  return { revisions: result.revisionCount, files };
}

/** Two different payloads of one length with the same 32-bit FNV-1a hash. */
function fnvCollision(): [Uint8Array, Uint8Array] {
  const fnv = (bytes: Uint8Array) => {
    let hash = 0x811c9dc5;
    for (const byte of bytes) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
    return hash;
  };
  const head = new TextEncoder().encode('\x89PNG payload ');
  const seen = new Map<number, Uint8Array>();
  for (let n = 0; ; n++) {
    const bytes = new Uint8Array(head.length + 8);
    bytes.set(head);
    new DataView(bytes.buffer).setFloat64(head.length, n * 1.000000001 + 0.5);
    const hash = fnv(bytes);
    const previous = seen.get(hash);
    if (previous && previous.join() !== bytes.join()) return [previous, bytes];
    seen.set(hash, bytes);
  }
}

test('images whose weak hashes collide still compare as different', () => {
  const [a, b] = fnvCollision();
  const body = `<w:p><w:r>${inlineImage('rIdImg', 1)}</w:r></w:p>${p('Caption')}`;
  const { revisions, files } = compared(
    buildDocx({ body, media: [{ name: 'image1.png', bytes: a, rId: 'rIdImg' }] }),
    buildDocx({ body, media: [{ name: 'image1.png', bytes: b, rId: 'rIdImg' }] })
  );
  expect(revisions).toBeGreaterThan(0);
  expect(files['word/document.xml']).toMatch(/<w:(ins|del)\b/);
}, 30_000);

test('a changed note reference attribute is recorded', () => {
  const reference = (attributes: string) =>
    `<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference${attributes} w:id="1"/></w:r>`;
  const doc = (attributes: string) =>
    buildDocx({
      body: `<w:p>${r('Claim')}${reference(attributes)}</w:p>${p('End')}`,
      footnotes: { 1: 'Source' },
    });
  const { revisions } = compared(doc(''), doc(' w:customMarkFollows="1"'));
  expect(revisions).toBeGreaterThan(0);
});

test('ids that hold placeholder characters survive assembly', () => {
  const revised = buildDocx({
    body: `<w:p>${r('Alpha ')}${commented('a§b' as never, r('beta'))}${r(' gamma')}</w:p>`,
    comments: [{ id: 'a§b' as never, author: 'Rev', text: 'Why?' }],
  });
  const { files } = compared(buildDocx({ body: p('Alpha beta gamma') }), revised);
  const id = /<w:commentReference\b[^>]*w:id="([^"]+)"/.exec(files['word/document.xml']!)?.[1];
  expect(id).toBeDefined();
  expect(files['word/comments.xml']).toContain(`w:id="${id}"`);
});

test('many list instances sharing one definition merge in linear time', () => {
  const nums = (count: number) =>
    Array.from(
      { length: count },
      (_, i) => `<w:num w:numId="${i + 1}"><w:abstractNumId w:val="0"/></w:num>`
    ).join('');
  const numbering =
    '<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/>' +
    `<w:lvlText w:val="%1."/></w:lvl></w:abstractNum>`;
  const doc = (text: string, count: number) =>
    buildDocx({ body: p(text), numbering: `${numbering}${nums(count)}</w:numbering>` });
  const started = performance.now();
  compared(doc('a', 40_000), doc('b', 40_000));
  expect(performance.now() - started).toBeLessThan(8_000);
  // List definitions count against the block limit, so their merge is bounded too.
  const result = compareDocuments(doc('a', 60_000), doc('b', 60_000), {
    authorName: 'Test',
    date: DATE,
  });
  expect(result.ok ? '' : result.code).toBe('too-large');
}, 60_000);

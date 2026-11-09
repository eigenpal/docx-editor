/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Inputs below the size limit whose cost grows faster than their size: a long field
// instruction copied into every word, a long space run scanned again from each space, and a
// long hunk passed as call arguments.
import { expect, test } from 'bun:test';
import { readOoxmlPackage } from '@docx-editor.dev/core/store';
import { buildDocx } from '../../../../../scripts/compare-corpus/docx-builder.ts';
import { p } from '../../../../../scripts/compare-corpus/xml.ts';
import { compareDocuments } from '../index.ts';
import { paragraphTokens, SignatureNames, type Token } from '../tokens.ts';
import { SideContext, unitsOf } from '../units.ts';
import { childNamed, NamespaceScope } from '../xml-fragments.ts';

const DATE = new Date('2026-01-10T12:00:00Z');
const docx = (body: string) => buildDocx({ body });
const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const compare = (base: Uint8Array, revised: Uint8Array) =>
  compareDocuments(base, revised, { authorName: 'Test', date: DATE });

/** A complex field with a long instruction and a result of many words. */
const fieldParagraph = (instruction: string, words: number, last: string) =>
  `<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
  `<w:r><w:instrText xml:space="preserve">${instruction}</w:instrText></w:r>` +
  `<w:r><w:fldChar w:fldCharType="separate"/></w:r>` +
  run(`${Array.from({ length: words }, (_, i) => `w${i}`).join(' ')} ${last}`) +
  `<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>`;

test('a word key names its field, not the field instruction', () => {
  const instruction = ` QUOTE "${'x'.repeat(100_000)}" `;
  const read = readOoxmlPackage(docx(fieldParagraph(instruction, 3000, 'end')));
  if (!read.ok) throw new Error(read.reason);
  const pkg = read.package;
  const body = childNamed(pkg.parts.get(pkg.mainDocumentPart)!.root, 'body')!;
  const side = new SideContext('base', pkg, pkg.mainDocumentPart, new NamespaceScope());
  const tokens: Token[] = [];
  const names = new SignatureNames();
  for (const unit of unitsOf(body, side))
    if (unit.kind === 'paragraph') paragraphTokens(unit, false, tokens, names);
  expect(tokens.length).toBeGreaterThan(3000);
  // The instruction is one token. Every result word carries a short name of its field, not
  // another copy of the instruction.
  const long = tokens.filter((token) => token.key.length > 1000);
  expect(long.length).toBe(1);
  expect(tokens.filter((token) => token.kind === 'text' && token.key.length < 100).length).toBe(
    tokens.filter((token) => token.kind === 'text').length - 1
  );
});

test('a field with a long instruction and many words compares', () => {
  const instruction = ` QUOTE "${'x'.repeat(100_000)}" `;
  const result = compare(
    docx(fieldParagraph(instruction, 3000, 'old') + p('tail')),
    docx(fieldParagraph(instruction, 3000, 'new') + p('tail'))
  );
  expect(result.ok && result.revisionCount).toBeGreaterThan(0);
}, 30_000);

function timed(base: Uint8Array, revised: Uint8Array): number {
  const started = performance.now();
  expect(compare(base, revised).ok).toBe(true);
  return performance.now() - started;
}

test('a long run of spaces in a block control stays linear', () => {
  const block = (spaces: number, word: string) =>
    `<w:sdt><w:sdtPr><w:tag w:val="t"/></w:sdtPr><w:sdtContent><w:p>` +
    `${run(`start${' '.repeat(spaces)}${word}`)}</w:p></w:sdtContent></w:sdt>${p('tail')}`;
  const pair = (spaces: number) =>
    [docx(block(spaces, 'old')), docx(block(spaces, 'new'))] as const;
  timed(...pair(20_000));
  const first = timed(...pair(20_000));
  const second = timed(...pair(80_000));
  // Four times the spaces: about four times the time when linear, sixteen when quadratic.
  expect(second / Math.max(first, 1)).toBeLessThan(8);
}, 120_000);

test('a long paragraph replaced as a whole returns a result, not a stack overflow', () => {
  const result = compare(
    docx(p('.'.repeat(600_000)) + p('tail')),
    docx(p('!'.repeat(600_000)) + p('tail'))
  );
  expect(result.ok && result.revisionCount).toBeGreaterThan(0);
}, 60_000);

/** Time at size `n` against time at `4n`, after a warm-up: about 4 when linear, 16 when quadratic. */
function growth(make: (n: number) => readonly [Uint8Array, Uint8Array], n: number): number {
  timed(...make(n));
  const first = timed(...make(n));
  const second = timed(...make(4 * n));
  return second / Math.max(first, 1);
}

test('bookmarks between many cells of one row stay linear', () => {
  const row = (cells: number, last: string) =>
    `<w:tbl><w:tblGrid>${'<w:gridCol w:w="100"/>'.repeat(cells)}</w:tblGrid><w:tr>` +
    Array.from(
      { length: cells },
      (_, i) =>
        `<w:bookmarkStart w:id="${i}" w:name="b${i}"/><w:bookmarkEnd w:id="${i}"/>` +
        `<w:tc>${p(i === cells - 1 ? last : `c${i}`)}</w:tc>`
    ).join('') +
    `</w:tr></w:tbl>${p('tail')}`;
  const make = (n: number) => [docx(row(n, 'old')), docx(row(n, 'new'))] as const;
  expect(growth(make, 3000)).toBeLessThan(8);
}, 120_000);

test('many text boxes in one drawing stay linear', () => {
  const group = (boxes: number, last: string) =>
    `<w:p><w:r><w:pict><v:group xmlns:v="urn:schemas-microsoft-com:vml" id="G1" ` +
    `style="width:216pt;height:72pt">` +
    Array.from(
      { length: boxes },
      (_, i) =>
        `<v:shape id="T${i}" type="#_x0000_t202" style="width:10pt;height:10pt"><v:textbox>` +
        `<w:txbxContent>${p(i === boxes - 1 ? last : `box ${i} ${'text '.repeat(200)}`)}` +
        `</w:txbxContent></v:textbox></v:shape>`
    ).join('') +
    `</v:group></w:pict></w:r></w:p>${p('tail')}`;
  const make = (n: number) => [docx(group(n, 'old')), docx(group(n, 'new'))] as const;
  expect(growth(make, 200)).toBeLessThan(8);
}, 120_000);

test('a long control alias beside long text stays linear', () => {
  // No id: the control is known by its whole properties, alias included.
  const control = (n: number, word: string) =>
    `<w:p><w:sdt><w:sdtPr><w:alias w:val="${'a'.repeat(10 * n)}"/></w:sdtPr><w:sdtContent>` +
    `${run(`${'same '.repeat(n)}${word}`)}</w:sdtContent></w:sdt></w:p>${p('tail')}`;
  const make = (n: number) => [docx(control(n, 'old')), docx(control(n, 'new'))] as const;
  expect(growth(make, 4000)).toBeLessThan(8);
}, 120_000);

test('a long header shared by many sections stays linear', () => {
  const doc = (n: number, word: string) =>
    buildDocx({
      body:
        Array.from(
          { length: n },
          (_, i) => `<w:p><w:pPr><w:sectPr/></w:pPr>${run(`s${i}`)}</w:p>`
        ).join('') + p(word),
      headers: { default: p('h'.repeat(400 * n)), first: undefined, even: undefined },
    });
  const make = (n: number) => [doc(n, 'old'), doc(n, 'new')] as const;
  expect(growth(make, 300)).toBeLessThan(8);
}, 120_000);

test('many fields inside one field with a long instruction stay linear', () => {
  const inner = (i: number) =>
    `<w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
    `<w:r><w:instrText xml:space="preserve"> SET f${i} </w:instrText></w:r>` +
    `<w:r><w:fldChar w:fldCharType="separate"/></w:r>${run(`v${i} `)}` +
    `<w:r><w:fldChar w:fldCharType="end"/></w:r>`;
  const outer = (n: number, word: string) =>
    `<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
    `<w:r><w:instrText xml:space="preserve"> QUOTE "${'x'.repeat(20 * n)}" </w:instrText></w:r>` +
    `<w:r><w:fldChar w:fldCharType="separate"/></w:r>` +
    Array.from({ length: n }, (_, i) => inner(i)).join('') +
    `${run(word)}<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>${p('tail')}`;
  const make = (n: number) => [docx(outer(n, 'old')), docx(outer(n, 'new'))] as const;
  expect(growth(make, 300)).toBeLessThan(8);
}, 120_000);

test('a word renamed in every paragraph shows each change, not one replacement of the text', () => {
  // 2,000 paragraphs, one word changed in each: more edits than one diff takes, and no
  // unchanged paragraph between them to split the work.
  const doc = (word: string) =>
    docx(
      Array.from({ length: 2000 }, (_, i) =>
        p(`Clause ${i}: the ${word} pays within 30 days.`)
      ).join('')
    );
  const result = compare(doc('Supplier'), doc('Vendor'));
  // One deletion and one insertion for each paragraph.
  expect(result.ok && result.revisionCount).toBe(4000);
}, 60_000);

test('a renamed word with a paragraph added still compares, as one replacement of the text', () => {
  // Different paragraph marks: the paragraphs cannot pair one to one, so the answer is coarse.
  const doc = (word: string, extra: boolean) =>
    docx(
      Array.from({ length: 2000 }, (_, i) => p(`Clause ${i}: the ${word} pays.`)).join('') +
        (extra ? p('An added closing clause.') : '')
    );
  const result = compare(doc('Supplier', false), doc('Vendor', true));
  expect(result.ok && result.revisionCount).toBeGreaterThan(0);
}, 60_000);

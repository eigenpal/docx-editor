/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Document structure that the synthetic corpus does not build: a main story without the
// relationships namespace, sections with their own headers, block content controls that go,
// and notes that nothing references. Each compare must succeed and pass its own check.
import { expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { compareDocuments } from '../index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml';
const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
const DATE = new Date('2026-01-10T12:00:00Z');

interface Part {
  readonly name: string;
  readonly type: string;
  readonly rel: string;
  readonly xml: string;
}

const p = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const header = (name: string, text: string): Part => ({
  name,
  type: `${CT}.header+xml`,
  rel: 'header',
  xml: `<w:hdr xmlns:w="${W}">${p(text)}</w:hdr>`,
});

function docx(body: string, parts: readonly Part[] = [], declareR = true): Uint8Array {
  const overrides = parts
    .map((part) => `<Override PartName="/word/${part.name}" ContentType="${part.type}"/>`)
    .join('');
  const rels = parts
    .map(
      (part, i) => `<Relationship Id="rId${i + 1}" Type="${R}/${part.rel}" Target="${part.name}"/>`
    )
    .join('');
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        `<Override PartName="/word/document.xml" ContentType="${CT}.document.main+xml"/>` +
        `${overrides}</Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:mc="${MC}" xmlns:wps="${WPS}"${declareR ? ` xmlns:r="${R}"` : ''}><w:body>${body}</w:body></w:document>`
    ),
  };
  if (parts.length > 0) {
    files['word/_rels/document.xml.rels'] = strToU8(
      `<Relationships xmlns="${PKG}">${rels}</Relationships>`
    );
  }
  for (const part of parts) files[`word/${part.name}`] = strToU8(part.xml);
  return zipSync(files, { mtime: new Date(2026, 0, 1) });
}

function compare(base: Uint8Array, revised: Uint8Array) {
  const result = compareDocuments(base, revised, { authorName: 'Test', date: DATE });
  if (!result.ok) throw new Error(result.message);
  return { files: unzipSync(result.bytes), revisionCount: result.revisionCount };
}

test('a header added to an original that declares no relationships namespace', () => {
  const base = docx(`${p('Body text')}<w:sectPr/>`, [], false);
  const revised = docx(
    `${p('Body text')}<w:sectPr><w:headerReference w:type="default" r:id="rId1"/></w:sectPr>`,
    [header('header1.xml', 'New header')]
  );
  const { files } = compare(base, revised);
  const document = strFromU8(files['word/document.xml']!);
  expect(document).toMatch(/<w:headerReference\b[^>]*\br:id="rId\w+"/);
  const added = Object.keys(files).find((name) => /^word\/compare-header/.test(name));
  expect(strFromU8(files[added!]!)).toContain('New header');
});

const twoSections = (first: string, last: string, text = 'Section two') =>
  docx(
    `<w:p><w:pPr><w:sectPr><w:headerReference w:type="default" r:id="rId1"/></w:sectPr></w:pPr><w:r><w:t>Section one</w:t></w:r></w:p>${p(text)}<w:sectPr><w:headerReference w:type="default" r:id="rId2"/></w:sectPr>`,
    [header('header1.xml', first), header('header2.xml', last)]
  );

test('the final section header compares when earlier headers are the same', () => {
  const base = twoSections('First header', 'Last original');
  const revised = twoSections('First header', 'Last revised', 'Section two changed');
  const { files } = compare(base, revised);
  expect(strFromU8(files['word/header1.xml']!)).not.toContain('<w:ins');
  const last = strFromU8(files['word/header2.xml']!);
  expect(last).toContain('<w:ins');
  expect(last).toContain('<w:del');
});

test('a changed header that only an earlier section shows is compared', () => {
  const { files } = compare(
    twoSections('First original', 'Last header'),
    twoSections('First revised', 'Last header')
  );
  const first = strFromU8(files['word/header1.xml']!);
  expect(first).toContain('<w:ins');
  expect(first).toContain('<w:del');
  expect(strFromU8(files['word/header2.xml']!)).not.toContain('<w:ins');
});

test('a header that only the revised earlier section shows is inserted in a new part', () => {
  const noHeaders = docx(
    `<w:p><w:pPr><w:sectPr/></w:pPr><w:r><w:t>Section one</w:t></w:r></w:p>${p('Section two')}<w:sectPr/>`
  );
  const { files } = compare(noHeaders, twoSections('First header', 'Last header'));
  const document = strFromU8(files['word/document.xml']!);
  // The first section break now references a header part that holds the inserted text.
  const firstBreak = /<w:pPr><w:sectPr>(.*?)<\/w:sectPr>/.exec(document)?.[1] ?? '';
  const id = /<w:headerReference\b[^>]*\br:id="([^"]+)"/.exec(firstBreak)?.[1];
  expect(id).toBeDefined();
  const rels = strFromU8(files['word/_rels/document.xml.rels']!);
  const target = new RegExp(`Id="${id}"[^>]*Target="([^"]+)"`).exec(rels)?.[1];
  const part = strFromU8(files[`word/${target}`]!);
  expect(part).toContain('First header');
  expect(part).toContain('<w:ins');
  expect(part).not.toContain('Last header');
});

test('a header the revised earlier section adds over an inherited one is refused', () => {
  // The original's second section inherits the first one's header. A reference there would
  // show an empty header after reject instead, so the compare has no faithful record.
  const threeSections = (middle: boolean) =>
    docx(
      `<w:p><w:pPr><w:sectPr><w:headerReference w:type="default" r:id="rId1"/></w:sectPr></w:pPr><w:r><w:t>One</w:t></w:r></w:p>` +
        `<w:p><w:pPr><w:sectPr>${middle ? '<w:headerReference w:type="default" r:id="rId3"/>' : ''}</w:sectPr></w:pPr><w:r><w:t>Two</w:t></w:r></w:p>` +
        `${p('Three')}<w:sectPr><w:headerReference w:type="default" r:id="rId2"/></w:sectPr>`,
      [
        header('header1.xml', 'Inherited header'),
        header('header2.xml', 'Last header'),
        header('header3.xml', 'Middle header'),
      ]
    );
  const result = compareDocuments(threeSections(false), threeSections(true), {
    authorName: 'Test',
    date: DATE,
  });
  expect(result.ok).toBe(false);
  if (!result.ok)
    expect(result).toMatchObject({ code: 'unsupportedContent', reason: 'headerFooter' });
});

test('block content controls that go are compared: their content is deleted, their shells stay', () => {
  const control = (text: string) =>
    `<w:sdt><w:sdtPr><w:alias w:val="${text}"/></w:sdtPr><w:sdtContent>${p(text)}</w:sdtContent></w:sdt>`;
  const base = docx(
    `${p('Kept')}${control('First control')}${control('Second control')}<w:tbl><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid><w:tr><w:tc>${p('Cell')}</w:tc></w:tr></w:tbl>${p('End')}<w:sectPr/>`
  );
  const revised = docx(
    `${p('Kept')}<w:tbl><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid><w:tr><w:tc>${p('Cell')}</w:tc></w:tr></w:tbl>${p('End')}<w:sectPr/>`
  );
  const result = compareDocuments(base, revised, { authorName: 'Test', date: DATE });
  if (!result.ok) throw new Error(result.message);
  const xml = strFromU8(unzipSync(result.bytes)['word/document.xml']!);
  // The controls stay, with their text recorded as deleted.
  expect(xml.match(/<w:sdt>/g)).toHaveLength(2);
  expect(xml).toMatch(/<w:delText[^>]*>First control<\/w:delText>/);
  expect(xml).toMatch(/<w:delText[^>]*>Second control<\/w:delText>/);
});

test('notes that nothing references do not take part', () => {
  const notes = (text: string): Part => ({
    name: 'endnotes.xml',
    type: `${CT}.endnotes+xml`,
    rel: 'endnotes',
    xml:
      `<w:endnotes xmlns:w="${W}">` +
      `<w:endnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:endnote>` +
      `<w:endnote w:id="1">${p(text)}</w:endnote></w:endnotes>`,
  });
  const base = docx(`${p('Body text')}<w:sectPr/>`);
  const revised = docx(`${p('Body text changed')}<w:sectPr/>`, [notes('Orphan note')]);
  const { files } = compare(base, revised);
  expect(strFromU8(files['word/document.xml']!)).toContain('<w:ins');
  const back = compare(revised, base);
  expect(strFromU8(back.files['word/document.xml']!)).toContain('<w:del');
});

test('a change inside a content-locked control is refused with its reason', () => {
  const control = (text: string) =>
    `<w:sdt><w:sdtPr><w:lock w:val="contentLocked"/></w:sdtPr><w:sdtContent>${p(text)}</w:sdtContent></w:sdt>`;
  const base = docx(`${control('Locked words here')}${p('End')}<w:sectPr/>`);
  const revised = docx(`${control('Locked text here')}${p('End')}<w:sectPr/>`);
  const result = compareDocuments(base, revised, { authorName: 'Test', date: DATE });
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.code).toBe('unsupportedContent');
    expect(result.message).toContain('locked or bound to data');
  }
  // Text outside the control still compares.
  const outside = docx(`${control('Locked words here')}${p('End changed')}<w:sectPr/>`);
  expect(compareDocuments(base, outside, { authorName: 'Test', date: DATE }).ok).toBe(true);
});

test('an input whose tracked changes cannot be accepted is refused', () => {
  const table = `<w:tbl><w:tblPr><w:ins w:id="20" w:author="A"/></w:tblPr><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid><w:tr><w:tc>${p('Cell')}</w:tc></w:tr></w:tbl>`;
  const odd = docx(`${p('Text')}${table}${p('End')}<w:sectPr/>`);
  const plain = docx(`${p('Text')}${p('End')}<w:sectPr/>`);
  const original = compareDocuments(odd, plain, { authorName: 'Test', date: DATE });
  expect(original.ok ? '' : original.message).toContain('original document holds tracked changes');
  const revised = compareDocuments(plain, odd, { authorName: 'Test', date: DATE });
  expect(revised.ok ? '' : revised.message).toContain('revised document holds tracked changes');
});

test('a cell that starts with a nested table keeps its order', () => {
  const grid = '<w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid>';
  const table = (cell: string) => `<w:tbl>${grid}<w:tr><w:tc>${cell}</w:tc></w:tr></w:tbl>`;
  const nested = table(p('Inner cell'));
  const base = docx(`${p('Before')}${table(`${nested}${p('Outer pad')}`)}${p('After')}<w:sectPr/>`);
  const revised = docx(`${p('Before')}${table(p('Replaced cell'))}${p('After')}<w:sectPr/>`);
  const { files } = compare(base, revised);
  const document = strFromU8(files['word/document.xml']!);
  expect(document.indexOf('Inner cell')).toBeLessThan(document.indexOf('Outer pad'));
});

test('a choice that requires a prefix the part root declares', () => {
  const choice = (text: string) =>
    `<w:p><w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:t>${text}</w:t></mc:Choice>` +
    `<mc:Fallback><w:t>${text}</w:t></mc:Fallback></mc:AlternateContent></w:r></w:p>`;
  const base = docx(`${choice('Shape')}${p('Body text')}<w:sectPr/>`);
  const revised = docx(`${choice('Shape')}${p('Body text changed')}<w:sectPr/>`);
  expect(compare(base, base).revisionCount).toBe(0);
  const { files } = compare(base, revised);
  expect(strFromU8(files['word/document.xml']!)).toMatch(/xmlns:wps=/);
});

test('a reference that leads nowhere in both documents stays as written', () => {
  const chart = `<w:p><w:r><w:t>Chart </w:t></w:r><w:r><w:drawing><c:chart xmlns:c="urn:chart" r:id="rId9"/></w:drawing></w:r></w:p>`;
  const base = docx(`${chart}${p('Body text')}<w:sectPr/>`);
  const revised = docx(`${chart}${p('Body text changed')}<w:sectPr/>`);
  expect(compare(base, base).revisionCount).toBe(0);
  const { files } = compare(base, revised);
  expect(strFromU8(files['word/document.xml']!)).toMatch(/<c:chart [\w.-]+:id="rId9"/);
});

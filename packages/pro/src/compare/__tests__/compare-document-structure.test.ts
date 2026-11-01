/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
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
      `<w:document xmlns:w="${W}"${declareR ? ` xmlns:r="${R}"` : ''}><w:body>${body}</w:body></w:document>`
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

test('earlier sections keep the original headers', () => {
  const section = (id: string) =>
    `<w:p><w:pPr><w:sectPr><w:headerReference w:type="default" r:id="${id}"/></w:sectPr></w:pPr><w:r><w:t>Section one</w:t></w:r></w:p>`;
  const base = docx(
    `${section('rId1')}${p('Section two')}<w:sectPr><w:headerReference w:type="default" r:id="rId2"/></w:sectPr>`,
    [header('header1.xml', 'First original'), header('header2.xml', 'Last original')]
  );
  const revised = docx(
    `${section('rId1')}${p('Section two changed')}<w:sectPr><w:headerReference w:type="default" r:id="rId2"/></w:sectPr>`,
    [header('header1.xml', 'First revised'), header('header2.xml', 'Last revised')]
  );
  const { files } = compare(base, revised);
  expect(strFromU8(files['word/header1.xml']!)).toContain('First original');
  expect(strFromU8(files['word/header1.xml']!)).not.toContain('<w:ins');
  const last = strFromU8(files['word/header2.xml']!);
  expect(last).toContain('<w:ins');
  expect(last).toContain('<w:del');
});

test('block content controls that go one after another', () => {
  const control = (text: string) =>
    `<w:sdt><w:sdtPr><w:alias w:val="${text}"/></w:sdtPr><w:sdtContent>${p(text)}</w:sdtContent></w:sdt>`;
  const base = docx(
    `${p('Kept')}${control('First control')}${control('Second control')}<w:tbl><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid><w:tr><w:tc>${p('Cell')}</w:tc></w:tr></w:tbl>${p('End')}<w:sectPr/>`
  );
  const revised = docx(
    `${p('Kept')}<w:tbl><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid><w:tr><w:tc>${p('Cell')}</w:tc></w:tr></w:tbl>${p('End')}<w:sectPr/>`
  );
  const { files, revisionCount } = compare(base, revised);
  expect(revisionCount).toBeGreaterThan(0);
  const document = strFromU8(files['word/document.xml']!);
  expect(document).toContain('<w:delText>First control</w:delText>');
  expect(document).toContain('<w:delText>Second control</w:delText>');
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

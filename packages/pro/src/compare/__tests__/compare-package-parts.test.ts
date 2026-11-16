/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// What content taken from the revised document needs in the output package: its own media
// under free names, the parts its relationships reach, its styles and lists, and paragraph
// children kept outside runs. Also the inputs a compare refuses, and its cost on long runs.
import { expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { buildDocx, solidPng } from '../../../../../scripts/compare-corpus/docx-builder.ts';
import { inlineImage, p, pRaw } from '../../../../../scripts/compare-corpus/xml.ts';
import { compareDocuments } from '../index.ts';

const DATE = new Date('2026-01-10T12:00:00Z');
const compare = (base: Uint8Array, revised: Uint8Array) =>
  compareDocuments(base, revised, { authorName: 'Test', date: DATE });

function files(base: Uint8Array, revised: Uint8Array) {
  const result = compare(base, revised);
  if (!result.ok) throw new Error(result.message);
  return unzipSync(result.bytes);
}

const same = (a: Uint8Array | undefined, b: Uint8Array) =>
  a !== undefined && a.length === b.length && a.every((value, i) => value === b[i]);

test('a copied picture never takes the name of a picture the original holds', () => {
  const red = solidPng(4, 4, [255, 0, 0]);
  const blue = solidPng(4, 4, [0, 0, 255]);
  const base = buildDocx({
    body: p('Lead text.') + pRaw(inlineImage('rIdA', 1)) + p('Tail text.'),
    media: [{ name: 'compare1.png', bytes: red, rId: 'rIdA' }],
  });
  const revised = buildDocx({
    body: p('Lead text.') + pRaw(inlineImage('rIdB', 2)) + p('Tail text.'),
    media: [{ name: 'new.png', bytes: blue, rId: 'rIdB' }],
  });
  const out = files(base, revised);
  expect(same(out['word/media/compare1.png'], red)).toBe(true);
  const copied = Object.keys(out).find((name) => name.startsWith('word/media/compare2'));
  expect(same(out[copied!], blue)).toBe(true);
});

test('a copied part keeps the parts its own relationships reach', () => {
  const chartRel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart';
  const packageRel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/package';
  const base = buildDocx({ body: p('Lead text.') + p('Tail text.') });
  const plain = unzipSync(buildDocx({ body: p('Lead text.') + p('Tail text.') }));
  const chart =
    '<w:p><w:r><w:drawing><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rIdChart"/></w:drawing></w:r></w:p>';
  plain['word/document.xml'] = strToU8(
    strFromU8(plain['word/document.xml']!).replace('<w:p>', `${chart}<w:p>`)
  );
  plain['word/_rels/document.xml.rels'] = strToU8(
    strFromU8(plain['word/_rels/document.xml.rels']!).replace(
      '</Relationships>',
      `<Relationship Id="rIdChart" Type="${chartRel}" Target="charts/chart1.xml"/></Relationships>`
    )
  );
  plain['word/charts/chart1.xml'] = strToU8(
    '<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"/>'
  );
  plain['word/charts/_rels/chart1.xml.rels'] = strToU8(
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      `<Relationship Id="rIdWb" Type="${packageRel}" Target="../embeddings/book.xlsx"/></Relationships>`
  );
  plain['word/embeddings/book.xlsx'] = new Uint8Array([1, 2, 3, 4]);
  const out = files(base, zipSync(plain, { mtime: new Date(2026, 0, 1) }));
  const rels = Object.keys(out).find((name) =>
    /^word\/media\/_rels\/compare\d+\.xml\.rels$/.test(name)
  );
  expect(rels).toBeDefined();
  const target = /Target="([^"]+)"/.exec(strFromU8(out[rels!]!))?.[1];
  expect(same(out[`word/media/${target}`], new Uint8Array([1, 2, 3, 4]))).toBe(true);
});

test('revised styles and lists the original lacks are added', () => {
  const numbering = (format: string) =>
    '<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    `<w:abstractNum w:abstractNumId="50"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="${format}"/>` +
    '<w:lvlText w:val="%1."/></w:lvl></w:abstractNum><w:num w:numId="77"><w:abstractNumId w:val="50"/></w:num></w:numbering>';
  const item = (text: string) =>
    p(text, '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="77"/></w:numPr>');
  const style =
    '<w:style w:type="paragraph" w:styleId="ClauseTitle"><w:name w:val="Clause Title"/></w:style>';
  const base = buildDocx({ body: item('Kept item.') + p('End.'), numbering: numbering('decimal') });
  const revised = buildDocx({
    body: item('Kept item.') + p('New clause.', '<w:pStyle w:val="ClauseTitle"/>') + p('End.'),
    numbering: numbering('upperRoman'),
    extraStyles: style,
  });
  const out = files(base, revised);
  expect(strFromU8(out['word/styles.xml']!)).toContain('w:styleId="ClauseTitle"');
  const document = strFromU8(out['word/document.xml']!);
  const list = strFromU8(out['word/numbering.xml']!);
  // The revised list differs from the original's list 77, so it takes a new id.
  const used = [...document.matchAll(/numId w:val="(\d+)"/g)].map((match) => match[1]);
  for (const id of used) expect(list).toMatch(new RegExp(`<w:num\\b[^>]*w:numId="${id}"`));
  expect(used.some((id) => id !== '77')).toBe(true);
  // The same list in both documents keeps its id and records no property change.
  const again = files(revised, revised);
  expect(strFromU8(again['word/document.xml']!)).not.toContain('pPrChange');
});

test('an equation stays a paragraph child, outside any run', () => {
  const math = (tail: string) =>
    '<w:p><w:r><w:t xml:space="preserve">Area is </w:t></w:r>' +
    '<m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><m:r><m:t>x</m:t></m:r></m:oMath>' +
    `<w:r><w:t xml:space="preserve"> ${tail}.</w:t></w:r></w:p>`;
  const out = files(buildDocx({ body: math('here') }), buildDocx({ body: math('there') }));
  const document = strFromU8(out['word/document.xml']!);
  expect(document).toContain('<m:oMath');
  expect(document).not.toMatch(/<w:r>(?:<w:rPr>.*?<\/w:rPr>)?<m:oMath/);
});

test('a long run of repeated deleted words compares in linear time', () => {
  const words = (n: number) => 'a '.repeat(n).trim();
  const base = buildDocx({ body: p(words(32000)) });
  const revised = buildDocx({ body: p(words(16000)) });
  const started = performance.now();
  expect(compare(base, revised).ok).toBe(true);
  expect(performance.now() - started).toBeLessThan(3000);
});

test('a document that enforces protection is refused', () => {
  const changed = buildDocx({ body: p('Body text changed.') });
  const protectedBy = (edit: string, body = p('Body text.')) =>
    buildDocx({ body, settings: `<w:documentProtection w:edit="${edit}" w:enforcement="1"/>` });
  // Tracked-changes protection too: a compare writes some differences without tracked changes.
  for (const edit of ['readOnly', 'comments', 'forms', 'trackedChanges']) {
    const result = compare(protectedBy(edit), changed);
    expect(result.ok ? '' : result.code).toBe('protected');
    expect(result.ok ? '' : result.message).toContain('protected against edits');
  }
  // Protection that is not enforced, or of a kind the format does not define, does not refuse.
  const off = buildDocx({
    body: p('Body text.'),
    settings: '<w:documentProtection w:edit="readOnly" w:enforcement="0"/>',
  });
  expect(compare(off, changed).ok).toBe(true);
});

test('block content with no tracked-change form is refused, not dropped', () => {
  const chunk =
    '<w:altChunk xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rIdChunk"/>';
  const plain = buildDocx({ body: p('Lead text.') + p('Tail text.') });
  const withChunk = buildDocx({ body: p('Lead text.') + chunk + p('Tail text.') });
  for (const [base, revised] of [
    [plain, withChunk],
    [withChunk, plain],
  ] as const) {
    const result = compare(base, revised);
    expect(result.ok ? '' : result.message).toContain('no tracked-change form');
  }
});

test('VML image data compares and copies by its relationship', () => {
  const red = solidPng(4, 4, [255, 0, 0]);
  const blue = solidPng(4, 4, [0, 0, 255]);
  const vml = (rId: string) =>
    '<w:p><w:r><w:pict><v:shape xmlns:v="urn:schemas-microsoft-com:vml" style="width:10pt;height:10pt">' +
    `<v:imagedata xmlns:o="urn:schemas-microsoft-com:office:office" o:relid="${rId}"/></v:shape></w:pict></w:r></w:p>`;
  const base = buildDocx({
    body: p('Lead text.') + vml('rIdImg1'),
    media: [{ name: 'image1.png', bytes: red, rId: 'rIdImg1' }],
  });
  const revised = buildDocx({
    body: p('Lead text.') + vml('rIdImg1'),
    media: [{ name: 'image1.png', bytes: blue, rId: 'rIdImg1' }],
  });
  const result = compare(base, revised);
  if (!result.ok) throw new Error(result.message);
  expect(result.revisionCount).toBeGreaterThan(0);
  const document = strFromU8(unzipSync(result.bytes)['word/document.xml']!);
  expect(document).toMatch(/o:relid="rIdCmp\d+"/);
});

test('a header reference type outside the defined ones does not take part', () => {
  const crafted = 'x"/><w:titlePg/><w:headerReference w:type="even';
  const base = buildDocx({ body: p('Body text.') });
  const revised = unzipSync(
    buildDocx({
      body: p('Body text.'),
      headers: { default: p('Head'), first: undefined, even: undefined },
    })
  );
  revised['word/document.xml'] = strToU8(
    strFromU8(revised['word/document.xml']!).replace(
      /(<w:headerReference\b[^>]*w:type=")default"/,
      `$1${crafted.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}"`
    )
  );
  const result = compare(base, zipSync(revised, { mtime: new Date(2026, 0, 1) }));
  if (!result.ok) throw new Error(result.message);
  const out = unzipSync(result.bytes);
  expect(strFromU8(out['word/document.xml']!)).not.toContain('titlePg');
  expect(Object.keys(out).some((name) => name.includes('compare-header'))).toBe(false);
});

test('two revised lists that look alike keep numbering apart', () => {
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const level =
    '<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl>';
  const item = (text: string, id: number) =>
    p(text, `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="${id}"/></w:numPr>`);
  const base = buildDocx({
    body: item('A1', 1) + p('End.'),
    numbering:
      `<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0">${level}</w:abstractNum>` +
      '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>',
  });
  const revised = buildDocx({
    body: item('A1', 1) + p('Between.') + item('B1', 2) + p('End.'),
    numbering:
      `<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0">${level}</w:abstractNum>` +
      `<w:abstractNum w:abstractNumId="5">${level}</w:abstractNum>` +
      '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>' +
      '<w:num w:numId="2"><w:abstractNumId w:val="5"/></w:num></w:numbering>',
    extraStyles:
      '<w:style w:type="paragraph" w:styleId="RevList"><w:name w:val="Rev List"/>' +
      '<w:pPr><w:numPr><w:numId w:val="2"/></w:numPr></w:pPr></w:style>',
  });
  const out = files(base, revised);
  const document = strFromU8(out['word/document.xml']!);
  const used = new Set([...document.matchAll(/numId w:val="(\d+)"/g)].map((match) => match[1]));
  expect(used.size).toBe(2);
  // The copied style names the list by its output id.
  const styles = strFromU8(out['word/styles.xml']!);
  const styleList = /w:styleId="RevList"[\s\S]*?numId w:val="(\d+)"/.exec(styles)?.[1];
  expect(styleList).toBeDefined();
  expect(styleList).not.toBe('1');
  expect(strFromU8(out['word/numbering.xml']!)).toMatch(new RegExp(`w:numId="${styleList}"`));
});

test('an external relationship of a copied part is written once', () => {
  const chartRel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart';
  const oleRel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/oleObject';
  const base = buildDocx({ body: p('Lead text.') + p('Tail text.') });
  const plain = unzipSync(buildDocx({ body: p('Lead text.') + p('Tail text.') }));
  const chart =
    '<w:p><w:r><w:drawing><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rIdChart"/></w:drawing></w:r></w:p>';
  plain['word/document.xml'] = strToU8(
    strFromU8(plain['word/document.xml']!).replace('<w:p>', `${chart}<w:p>`)
  );
  plain['word/_rels/document.xml.rels'] = strToU8(
    strFromU8(plain['word/_rels/document.xml.rels']!).replace(
      '</Relationships>',
      `<Relationship Id="rIdChart" Type="${chartRel}" Target="charts/chart1.xml"/></Relationships>`
    )
  );
  plain['word/charts/chart1.xml'] = strToU8(
    '<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"/>'
  );
  plain['word/charts/_rels/chart1.xml.rels'] = strToU8(
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      `<Relationship Id="rIdWb" Type="${oleRel}" Target="file:///C:/data/book.xlsx" TargetMode="External"/></Relationships>`
  );
  const out = files(base, zipSync(plain, { mtime: new Date(2026, 0, 1) }));
  const rels = Object.keys(out).find((name) =>
    /^word\/media\/_rels\/compare\d+\.xml\.rels$/.test(name)
  );
  expect(strFromU8(out[rels!]!).match(/Id="rIdWb"/g)?.length).toBe(1);
});

/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The compare reads and writes the parts the editor paints with: headers and footers as the
// store resolves them per section, styles both readers agree on, and relationship parts in
// any well-formed shape.
import { expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { buildDocx } from '../../../../../scripts/compare-corpus/docx-builder.ts';
import { p } from '../../../../../scripts/compare-corpus/xml.ts';
import { applyTreeOp, readOoxmlPackage, serializeOoxmlPart } from '@docx-editor.dev/core/store';
import { compareDocuments } from '../index.ts';

const DATE = new Date('2026-01-10T12:00:00Z');

function edited(docx: Uint8Array, change: (files: Record<string, string>) => void): Uint8Array {
  const files: Record<string, string> = {};
  for (const [name, bytes] of Object.entries(unzipSync(docx))) files[name] = strFromU8(bytes);
  change(files);
  const out: Record<string, Uint8Array> = {};
  for (const [name, text] of Object.entries(files)) out[name] = strToU8(text);
  return zipSync(out, { mtime: new Date(2026, 0, 1) });
}

function compared(base: Uint8Array, revised: Uint8Array): Record<string, string> {
  const result = compareDocuments(base, revised, { authorName: 'Test', date: DATE });
  if (!result.ok) throw new Error(result.message);
  const files: Record<string, string> = {};
  for (const [name, bytes] of Object.entries(unzipSync(result.bytes)))
    files[name] = strFromU8(bytes);
  return files;
}

const withHeader = (text: string) =>
  buildDocx({
    body: p('Body text.'),
    headers: { default: p(text), first: undefined, even: undefined },
  });

test('a final section that inherits its header compares that header', () => {
  const inheriting = (text: string) =>
    edited(withHeader(text), (files) => {
      const document = files['word/document.xml']!;
      const sectPr = /<w:sectPr>[\s\S]*<\/w:sectPr>/.exec(document)![0];
      const bare = sectPr.replace(/<w:headerReference[^>]*\/>/g, '');
      files['word/document.xml'] = document.replace(
        sectPr,
        `<w:p><w:pPr>${sectPr}</w:pPr></w:p>${p('Section two.')}${bare}`
      );
    });
  const out = compared(inheriting('Alpha header'), inheriting('Gamma header'));
  expect(out['word/header1.xml']).toContain('<w:ins');
  expect(out['word/header1.xml']).toContain('Gamma');
});

test('headers resolve like the editor: first reference wins, targets are decoded', () => {
  // The original names its header through a percent-encoded target and a later duplicate.
  const base = edited(withHeader('Alpha header'), (files) => {
    files['word/_rels/document.xml.rels'] = files['word/_rels/document.xml.rels']!.replace(
      'Target="header1.xml"',
      'Target="header%31.xml"'
    );
    files['word/document.xml'] = files['word/document.xml']!.replace(
      /(<w:headerReference[^>]*\/>)/,
      '$1$1'
    );
  });
  const out = compared(base, withHeader('Gamma header'));
  expect(out['word/header1.xml']).toContain('<w:ins');
  expect(out['word/document.xml']!.match(/<w:headerReference\b/g)?.length).toBe(2);
  expect(Object.keys(out).some((name) => name.includes('compare-header'))).toBe(false);
});

test('a new relationship is recorded in an empty relationships part', () => {
  const rels = (inner: string) =>
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"' +
    (inner ? `>${inner}</Relationships>` : '/>');
  // A target with a quote has no field form, so the inserted link keeps its own element and
  // needs a relationship of the header.
  const link =
    '<w:p><w:hyperlink xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
    'r:id="rIdL1"><w:r><w:t>Visit</w:t></w:r></w:hyperlink></w:p>';
  const base = edited(withHeader('Head'), (files) => {
    files['word/_rels/header1.xml.rels'] = rels('');
  });
  const revised = edited(
    buildDocx({
      body: p('Body text.'),
      headers: { default: p('Head') + link, first: undefined, even: undefined },
    }),
    (files) => {
      files['word/_rels/header1.xml.rels'] = rels(
        '<Relationship Id="rIdL1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com/?q=&quot;x&quot;" TargetMode="External"/>'
      );
    }
  );
  const out = compared(base, revised);
  const id = /<w:hyperlink\b[^>]*r:id="([^"]+)"/.exec(out['word/header1.xml']!)?.[1];
  expect(id).toBeDefined();
  expect(out['word/_rels/header1.xml.rels']).toContain(`Id="${id}"`);
});

test('styles go to a part every reader finds, never to an unrelated styles.xml', () => {
  const fancy = '<w:style w:type="paragraph" w:styleId="Fancy"><w:name w:val="Fancy"/></w:style>';
  const decoy = '<x:data xmlns:x="urn:example:data"><x:v>1</x:v></x:data>';
  // No styles relationship and no /word/styles.xml; an unrelated part is named styles.xml.
  const base = edited(buildDocx({ body: p('One.') }), (files) => {
    files['word/_rels/document.xml.rels'] = files['word/_rels/document.xml.rels']!.replace(
      /<Relationship [^>]*Type="[^"]*\/styles"[^>]*\/>/,
      ''
    );
    delete files['word/styles.xml'];
    files['customXml/styles.xml'] = decoy;
    files['[Content_Types].xml'] = files['[Content_Types].xml']!.replace(
      /<Override PartName="\/word\/styles\.xml"[^>]*\/>/,
      ''
    );
  });
  const revised = buildDocx({
    body: p('One.') + p('Two.', '<w:pStyle w:val="Fancy"/>'),
    extraStyles: fancy,
  });
  const out = compared(base, revised);
  expect(out['customXml/styles.xml']).toBe(decoy);
  expect(out['word/_rels/document.xml.rels']).toMatch(/relationships\/styles"/);
  const stylesPart = Object.entries(out).find(
    ([name, text]) => name.startsWith('word/') && text.includes('w:styleId="Fancy"')
  );
  expect(stylesPart).toBeDefined();
});

test('a final section only one document declares records its settings as a change', () => {
  const a4 =
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="2000" w:right="2000" ' +
    'w:bottom="2000" w:left="2000" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>';
  const without = edited(buildDocx({ body: p('Same text.') }), (files) => {
    files['word/document.xml'] = files['word/document.xml']!.replace(
      /<w:sectPr>[\s\S]*<\/w:sectPr>/,
      ''
    );
  });
  const withA4 = buildDocx({ body: p('Same text.'), sectPr: a4 });
  for (const [base, revised] of [
    [without, withA4],
    [withA4, without],
  ] as const) {
    expect(compared(base, revised)['word/document.xml']).toContain('<w:sectPrChange');
  }
});

test('a new note never takes the id of a separator copied with it', () => {
  const reference = '<w:r><w:footnoteReference w:id="2"/></w:r>';
  const revised = edited(
    buildDocx({
      body: `<w:p><w:r><w:t>Claim.</w:t></w:r>${reference}</w:p>`,
      footnotes: { 2: p('Source note.') },
    }),
    (files) => {
      files['word/footnotes.xml'] = files['word/footnotes.xml']!.replace(
        'w:type="separator" w:id="-1"',
        'w:type="separator" w:id="0"'
      ).replace(
        'w:type="continuationSeparator" w:id="0"',
        'w:type="continuationSeparator" w:id="1"'
      );
    }
  );
  const out = compared(buildDocx({ body: p('Claim.') }), revised);
  const ids = [...out['word/footnotes.xml']!.matchAll(/<w:footnote\b[^>]*w:id="([^"]+)"/g)].map(
    (match) => match[1]
  );
  expect(ids).toContain('1');
  expect(new Set(ids).size).toBe(ids.length);
});

test('a section record names the settings only the revised document states', () => {
  const margins =
    '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" ' +
    'w:footer="720" w:gutter="0"/>';
  const base = buildDocx({
    body: p('Same text.'),
    sectPr: `<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>${margins}</w:sectPr>`,
  });
  const revised = buildDocx({
    body: p('Same text.'),
    sectPr:
      `<w:sectPr><w:pgSz w:w="15840" w:h="12240" w:orient="landscape"/>${margins}` +
      '<w:vAlign w:val="center"/><w:titlePg/><w:pgNumType w:start="5"/></w:sectPr>',
  });
  const record = /<w:sectPrChange\b[\s\S]*?<\/w:sectPrChange>/.exec(
    compared(base, revised)['word/document.xml']!
  )?.[0];
  expect(record).toContain('w:orient="portrait"');
  expect(record).toContain('<w:vAlign w:val="top"/>');
  expect(record).toContain('<w:titlePg w:val="0"/>');
  expect(record).toContain('<w:pgNumType w:start="0"/>');
});

test('a section setting with no value to restore is refused', () => {
  const base = buildDocx({ body: p('Same text.') });
  const revised = edited(base, (files) => {
    files['word/document.xml'] = files['word/document.xml']!.replace(
      '</w:sectPr>',
      '<w:pgBorders><w:top w:val="single" w:sz="4" w:space="24" w:color="auto"/></w:pgBorders></w:sectPr>'
    );
  });
  const result = compareDocuments(base, revised, { authorName: 'Test', date: DATE });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.code).toBe('unsupportedContent');
});

test('a copied separator never takes an id the original references', () => {
  // The original holds a dangling reference to id 0 and no notes part.
  const ref = (id: number) => `<w:r><w:footnoteReference w:id="${id}"/></w:r>`;
  const para = (text: string, reference = '') =>
    `<w:p><w:r><w:t>${text}</w:t></w:r>${reference}</w:p>`;
  const base = buildDocx({ body: para('Alpha', ref(0)) + para('Beta') });
  const revised = buildDocx({
    body: para('Alpha') + para('Beta', ref(1)),
    footnotes: { 1: 'New note' },
  });
  const notes =
    Object.entries(compared(base, revised)).find(([name]) =>
      /footnotes\d*\.xml$/.test(name)
    )?.[1] ?? '';
  const separatorIds = [
    ...notes.matchAll(
      /<w:footnote\b(?=[^>]*w:type="(?:separator|continuationSeparator)")[^>]*w:id="([^"]+)"/g
    ),
  ].map((match) => match[1]);
  expect(separatorIds.length).toBeGreaterThan(0);
  expect(separatorIds).not.toContain('0');
});

const sectionBreaks = (xml: string) => xml.match(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/g) ?? [];

function acceptedMain(bytes: Uint8Array): string {
  const read = readOoxmlPackage(bytes);
  if (!read.ok) throw new Error(read.reason);
  const part = read.package.parts.get(read.package.mainDocumentPart)!;
  const accepted = applyTreeOp(part, { op: 'acceptAllRevisions' });
  if (!accepted.ok) throw new Error(accepted.reason);
  return serializeOoxmlPart(accepted.part);
}

test('a section break the revised document moves keeps its header', () => {
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const sections = (breakAfter: string) =>
    edited(withHeader('Final header'), (files) => {
      files['word/header2.xml'] = `<w:hdr xmlns:w="${W}">${p('Section one header')}</w:hdr>`;
      files['[Content_Types].xml'] = files['[Content_Types].xml']!.replace(
        '</Types>',
        '<Override PartName="/word/header2.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/></Types>'
      );
      files['word/_rels/document.xml.rels'] = files['word/_rels/document.xml.rels']!.replace(
        '</Relationships>',
        '<Relationship Id="rIdH2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header2.xml"/></Relationships>'
      );
      const sect =
        '<w:sectPr><w:headerReference w:type="default" r:id="rIdH2"/><w:type w:val="continuous"/></w:sectPr>';
      files['word/document.xml'] = files['word/document.xml']!.replace(
        p('Body text.'),
        ['One.', 'Two.', 'Three.']
          .map((text) =>
            text === breakAfter
              ? `<w:p><w:pPr>${sect}</w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`
              : p(text)
          )
          .join('')
      );
    });
  const result = compareDocuments(sections('One.'), sections('Two.'), {
    authorName: 'Test',
    date: DATE,
  });
  if (!result.ok) throw new Error(result.message);
  expect(sectionBreaks(acceptedMain(result.bytes))[0]).toContain('<w:headerReference');
});

test('section records follow the schema order and grid records carry only an id', () => {
  const grid = (widths: string, sect: string) =>
    buildDocx({
      body:
        `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid>${widths}</w:tblGrid>` +
        `<w:tr><w:tc>${p('a')}</w:tc></w:tr></w:tbl>${p('End.')}`,
      sectPr: sect,
    });
  const fields = '<w:pgSz w:w="12240" w:h="15840"/><w:docGrid w:linePitch="360"/>';
  const out = compared(
    grid('<w:gridCol w:w="4000"/>', `<w:sectPr>${fields}</w:sectPr>`),
    grid('<w:gridCol w:w="6000"/>', `<w:sectPr><w:type w:val="continuous"/>${fields}</w:sectPr>`)
  )['word/document.xml']!;
  const record = /<w:sectPrChange\b[^>]*><w:sectPr>([\s\S]*?)<\/w:sectPr>/.exec(out)?.[1] ?? '';
  const names = [...record.matchAll(/<w:([A-Za-z]+)/g)].map((match) => match[1]);
  expect(names).toContain('type');
  expect(names.indexOf('type')).toBeLessThan(names.indexOf('pgSz'));
  expect(out).toMatch(/<w:tblGridChange w:id="\d+">/);
});

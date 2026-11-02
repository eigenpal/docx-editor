/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
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
        '<Relationship Id="rIdL1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com/" TargetMode="External"/>'
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

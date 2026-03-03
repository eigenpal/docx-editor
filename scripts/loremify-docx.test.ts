import { describe, expect, test } from 'bun:test';
import path from 'path';
import {
  LoremWordGenerator,
  applyCasing,
  decodeXmlEntities,
  loremifyXml,
  parseArgs,
  sanitizeMetadataXml,
  stripMediaMarkupFromWordXml,
  stripMediaReferencesFromRels,
} from './loremify-docx';

describe('loremify-docx helpers', () => {
  test('applyCasing preserves upper, title, and lower casing', () => {
    expect(applyCasing('HELLO', 'ipsum')).toBe('IPSUM');
    expect(applyCasing('Hello', 'ipsum')).toBe('Ipsum');
    expect(applyCasing('hello', 'IPSUM')).toBe('ipsum');
  });

  test('decodeXmlEntities decodes named and numeric entities', () => {
    expect(decodeXmlEntities('A &amp; B')).toBe('A & B');
    expect(decodeXmlEntities('&#65;&#x42;')).toBe('AB');
    expect(decodeXmlEntities('&unknown;')).toBe('&unknown;');
  });

  test('parseArgs parses options and resolves inputs', () => {
    const options = parseArgs([
      'sample.docx',
      '--out-dir',
      'sanitized',
      '--suffix',
      '.anon',
      '--all-xml',
      '--strip-media',
    ]);

    expect(options.inputs).toEqual([path.resolve('sample.docx')]);
    expect(options.outDir).toBe(path.resolve('sanitized'));
    expect(options.suffix).toBe('.anon');
    expect(options.allXml).toBe(true);
    expect(options.stripMedia).toBe(true);
  });

  test('parseArgs rejects unknown options', () => {
    expect(() => parseArgs(['sample.docx', '--unknown'])).toThrow('Unknown option: --unknown');
  });

  test('loremifyXml preserves numeric text while replacing words', () => {
    const inputXml =
      '<w:document><w:body><w:p><w:r><w:t>Invoice 2026-01-15 A1B2</w:t></w:r></w:p></w:body></w:document>';
    const result = loremifyXml(inputXml, new LoremWordGenerator());

    expect(result.replacedWords).toBe(3);
    expect(result.xml).toContain('<w:t>Loremlo 2026-01-15 I1D2</w:t>');
  });

  test('sanitizeMetadataXml sanitizes core and app properties', () => {
    const coreXml =
      '<cp:coreProperties><dc:creator>Alice</dc:creator><cp:lastModifiedBy>Bob</cp:lastModifiedBy><cp:revision>42</cp:revision></cp:coreProperties>';
    const appXml =
      '<Properties><Company>Acme</Company><Manager>Carol</Manager><HyperlinkBase>https://example.com</HyperlinkBase></Properties>';

    const sanitizedCore = sanitizeMetadataXml('docProps/core.xml', coreXml);
    const sanitizedApp = sanitizeMetadataXml('docProps/app.xml', appXml);

    expect(sanitizedCore.sanitizedFields).toBe(3);
    expect(sanitizedCore.xml).toContain('<dc:creator>Sanitized</dc:creator>');
    expect(sanitizedCore.xml).toContain('<cp:lastModifiedBy>Sanitized</cp:lastModifiedBy>');
    expect(sanitizedCore.xml).toContain('<cp:revision>1</cp:revision>');

    expect(sanitizedApp.sanitizedFields).toBe(3);
    expect(sanitizedApp.xml).toContain('<Company>Sanitized</Company>');
    expect(sanitizedApp.xml).toContain('<Manager>Sanitized</Manager>');
    expect(sanitizedApp.xml).toContain('<HyperlinkBase></HyperlinkBase>');
  });

  test('stripMediaReferencesFromRels removes media relationships only', () => {
    const relsXml = `<Relationships>
  <Relationship Id="rId1" Target="media/image1.png" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"/>
  <Relationship Id="rId2" Target="styles.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles"/>
</Relationships>`;

    const stripped = stripMediaReferencesFromRels(relsXml);
    expect(stripped).not.toContain('media/image1.png');
    expect(stripped).toContain('styles.xml');
  });

  test('stripMediaMarkupFromWordXml removes drawing and pict blocks', () => {
    const wordXml = `<w:p>
  <w:r><w:drawing><wp:inline>img</wp:inline></w:drawing></w:r>
  <w:r><w:pict><v:shape/></w:pict></w:r>
  <w:r><w:t>Keep me</w:t></w:r>
</w:p>`;

    const stripped = stripMediaMarkupFromWordXml(wordXml);
    expect(stripped).not.toContain('<w:drawing>');
    expect(stripped).not.toContain('<w:pict>');
    expect(stripped).toContain('<w:t>Keep me</w:t>');
  });
});

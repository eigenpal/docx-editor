// Styles + numbering parsing (document-engine task 2.7 partial).

import { describe, expect, test } from 'bun:test';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { parseDocx } from '../src/index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function docx(): Uint8Array {
  return zipSync({
    '[Content_Types].xml':
      strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    'word/document.xml': strToU8(`<w:document xmlns:w="${W}"><w:body><w:p/></w:body></w:document>`),
    'word/styles.xml': strToU8(
      `<w:styles xmlns:w="${W}">` +
        `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>` +
        `<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>` +
        `<w:style w:type="character" w:styleId="Strong"><w:name w:val="Strong"/></w:style>` +
        `</w:styles>`,
    ),
    'word/numbering.xml': strToU8(
      `<w:numbering xmlns:w="${W}">` +
        `<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>` +
        `<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>` +
        `</w:numbering>`,
    ),
  });
}

describe('styles', () => {
  test('parses styleId, name, type, and default flag', () => {
    const r = parseDocx(docx());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const byId = new Map(r.model.styles.map((s) => [s.id, s]));
    expect(byId.get('Normal')).toMatchObject({ name: 'Normal', type: 'paragraph', isDefault: true });
    expect(byId.get('Heading1')).toMatchObject({ name: 'heading 1', type: 'paragraph' });
    expect(byId.get('Strong')).toMatchObject({ type: 'character' });
  });
});

describe('numbering', () => {
  test('parses numId -> abstractNumId', () => {
    const r = parseDocx(docx());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.model.numbering).toEqual([
      { numId: '1', abstractId: '0' },
      { numId: '2', abstractId: '1' },
    ]);
  });
});

describe('real fixture', () => {
  const fixture = join(import.meta.dir, '..', '..', '..', 'e2e', 'fixtures', 'comprehensive-word-element-test.docx');
  test.if(existsSync(fixture))('a rich fixture yields multiple styles', () => {
    const r = parseDocx(new Uint8Array(readFileSync(fixture)));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.model.styles.length).toBeGreaterThan(1);
  });
});

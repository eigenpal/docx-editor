// Block-SDT (content control) layout: a content control is transparent to flow layout,
// so its nested paragraphs/tables lay out in place (the control kind does not change how
// content flows). Verifies the render leg of the structural-SDT slice: SDT text reaches
// the display list and an SDT wrapping a table still emits cell rects + text.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { zipSync, strToU8 } from 'fflate';
import { layoutBody, createDeterministicLayoutShaping, type LayoutOptions } from '../src/index.ts';
import { parseDocx } from '@docx-editor.dev/engine-core';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
function docxOf(inner: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${inner}</w:body></w:document>`
    ),
  });
}
function model(inner: string) {
  const r = parseDocx(docxOf(inner));
  if (!r.ok) throw new Error(`parse failed: ${r.reason} ${r.detail ?? ''}`);
  return r.model;
}
function opts(): LayoutOptions {
  return {
    pageWidth: 12240,
    pageHeight: 15840,
    margin: 1440,
    shaping: createDeterministicLayoutShaping(),
  };
}
const textOf = (items: { type: string }[]) =>
  items.map((i) => (i.type === 'text' ? (i as { text: string }).text : '')).join(' ');

describe('block-SDT layout (content control is transparent to flow)', () => {
  test('an SDT wrapping paragraphs flows its text into the display list', () => {
    const m = model(
      '<w:p><w:r><w:t>before</w:t></w:r></w:p>' +
        '<w:sdt><w:sdtPr><w:tag w:val="t"/><w:richText/></w:sdtPr><w:sdtContent>' +
        '<w:p><w:r><w:t>inside</w:t></w:r></w:p></w:sdtContent></w:sdt>' +
        '<w:p><w:r><w:t>after</w:t></w:r></w:p>'
    );
    const items = layoutBody(m, opts()).pages.flatMap((p) => p.items);
    const all = textOf(items);
    for (const t of ['before', 'inside', 'after']) expect(all).toContain(t);
  });

  test('an SDT wrapping a table still emits cell rects and cell text', () => {
    const m = model(
      '<w:sdt><w:sdtPr><w:tag w:val="tbl"/></w:sdtPr><w:sdtContent>' +
        '<w:tbl><w:tblGrid><w:gridCol w:w="4000"/><w:gridCol w:w="4000"/></w:tblGrid>' +
        '<w:tr><w:tc><w:p><w:r><w:t>X1</w:t></w:r></w:p></w:tc>' +
        '<w:tc><w:p><w:r><w:t>Y1</w:t></w:r></w:p></w:tc></w:tr>' +
        '</w:tbl></w:sdtContent></w:sdt>'
    );
    const result = layoutBody(m, opts());
    const items = result.pages.flatMap((p) => p.items);
    expect(items.filter((i) => i.type === 'rect').length).toBeGreaterThanOrEqual(2); // two cells
    const all = textOf(items);
    expect(all).toContain('X1');
    expect(all).toContain('Y1');
    expect(result.status).toBe('converged');
  });

  test('a real content-control fixture lays out without crashing and emits text', () => {
    const bytes = readFileSync(`${import.meta.dir}/../../../e2e/fixtures/block-sdt-showcase.docx`);
    const r = parseDocx(bytes);
    if (!r.ok) throw new Error(`parse failed: ${r.reason}`);
    const result = layoutBody(r.model, opts());
    expect(result.status).toBe('converged');
    expect(result.pages.flatMap((p) => p.items).some((i) => i.type === 'text')).toBe(true);
  });
});

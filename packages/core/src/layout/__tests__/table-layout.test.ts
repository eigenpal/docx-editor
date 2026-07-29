// Table layout (document-engine section 8 / fidelity slice 1): a structural table
// lays out into per-cell text plus border/shading rects, and does not crash the
// paragraph-only layout path.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { zipSync, strToU8 } from 'fflate';
import { layoutBody, createDeterministicLayoutShaping, type LayoutOptions } from '../index.ts';
import { parseDocx, bodyStoryId, type TableRecord } from '@docx-editor.dev/engine-core';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
function docxOf(inner: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8('<Types/>'),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${inner}</w:body></w:document>`
    ),
  });
}
function parseInner(inner: string) {
  const r = parseDocx(docxOf(inner));
  if (!r.ok) throw new Error(`parse failed: ${r.reason}`);
  return r.model;
}

function opts(over: Partial<LayoutOptions> = {}): LayoutOptions {
  return {
    pageWidth: 12240,
    pageHeight: 15840,
    margin: 1440,
    shaping: createDeterministicLayoutShaping(),
    ...over,
  };
}

function withTablesModel() {
  const bytes = readFileSync(`${import.meta.dir}/../../../../../e2e/fixtures/with-tables.docx`);
  const r = parseDocx(bytes);
  if (!r.ok) throw new Error(`parse failed: ${r.reason}`);
  return r.model;
}

describe('table layout', () => {
  test('a real table document lays out without crashing and emits cells + text', () => {
    const model = withTablesModel();
    const result = layoutBody(model, opts());
    const items = result.pages.flatMap((p) => p.items);
    const rects = items.filter((i) => i.type === 'rect');
    const texts = items.filter((i) => i.type === 'text');
    // 3x3 table -> 9 cell rects, and the cell text A1..C3 is present.
    expect(rects.length).toBeGreaterThanOrEqual(9);
    const allText = texts.map((t) => (t.type === 'text' ? t.text : '')).join(' ');
    for (const cell of ['A1', 'B2', 'C3']) expect(allText).toContain(cell);
    expect(result.status).toBe('converged');
  });

  test('cell borders are integer-positioned rects sized to their row', () => {
    const result = layoutBody(withTablesModel(), opts());
    const rects = result.pages.flatMap((p) => p.items).filter((i) => i.type === 'rect');
    for (const r of rects) {
      expect(Number.isInteger(r.x) && Number.isInteger(r.y)).toBe(true);
      expect(r.width).toBeGreaterThan(0);
      expect(r.height).toBeGreaterThan(0);
    }
  });

  test('a nested table in a cell has declared geometry (its own cell rects), not skipped', () => {
    const inner =
      '<w:tbl><w:tr><w:tc>' +
      '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>innercell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' +
      '</w:tc></w:tr></w:tbl>';
    const result = layoutBody(parseInner(inner), opts());
    const items = result.pages.flatMap((p) => p.items);
    const rects = items.filter((i) => i.type === 'rect');
    const texts = items.filter((i) => i.type === 'text');
    // Outer cell rect + inner cell rect = the nested table has geometry, not skipped.
    expect(rects.length).toBeGreaterThanOrEqual(2);
    expect(texts.map((t) => (t.type === 'text' ? t.text : '')).join(' ')).toContain('innercell');
    // The inner cell rect is indented inside the outer cell rect (distinct x positions).
    const xs = new Set(rects.map((r) => (r.type === 'rect' ? r.x : -1)));
    expect(xs.size).toBeGreaterThanOrEqual(2);
  });

  test('a tblHeader row repeats atop each page when the table paginates', () => {
    const header =
      '<w:tr><w:trPr><w:tblHeader/></w:trPr><w:tc><w:p><w:r><w:t>HDR</w:t></w:r></w:p></w:tc></w:tr>';
    const bodyRows = Array.from(
      { length: 12 },
      (_, i) => `<w:tr><w:tc><w:p><w:r><w:t>R${i}</w:t></w:r></w:p></w:tc></w:tr>`
    ).join('');
    const model = parseInner(`<w:tbl>${header}${bodyRows}</w:tbl>`);
    // A short page so the table spans multiple pages.
    const result = layoutBody(model, opts({ pageHeight: 3600 }));
    expect(result.pages.length).toBeGreaterThan(1);
    const hdrOnPage = result.pages.map((p) =>
      p.items.some((i) => i.type === 'text' && i.text === 'HDR')
    );
    expect(hdrOnPage[0]).toBe(true); // header on the first page
    expect(hdrOnPage[1]).toBe(true); // AND repeated on the second page
    expect(hdrOnPage.filter(Boolean).length).toBe(result.pages.length); // on every page the table occupies
  });

  test('vMerge continue cells do not duplicate the restart cell content', () => {
    const rows =
      '<w:tr><w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr><w:p><w:r><w:t>merged</w:t></w:r></w:p></w:tc>' +
      '<w:tc><w:p><w:r><w:t>a</w:t></w:r></w:p></w:tc></w:tr>' +
      '<w:tr><w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p><w:r><w:t>SHOULDHIDE</w:t></w:r></w:p></w:tc>' +
      '<w:tc><w:p><w:r><w:t>b</w:t></w:r></w:p></w:tc></w:tr>';
    const result = layoutBody(parseInner(`<w:tbl>${rows}</w:tbl>`), opts());
    const texts = result.pages
      .flatMap((p) => p.items)
      .filter((i) => i.type === 'text')
      .map((i) => (i.type === 'text' ? i.text : ''));
    expect(texts.filter((t) => t === 'merged')).toHaveLength(1); // the merged content appears once
    expect(texts).not.toContain('SHOULDHIDE'); // the continue cell emits no content
    expect(texts).toContain('a');
    expect(texts).toContain('b');
  });

  test('column widths come from the grid when present', () => {
    const model = withTablesModel();
    const table = model.stories
      .get(bodyStoryId(model))!
      .blocks.find((b) => b.kind === 'table') as TableRecord;
    const result = layoutBody(model, opts());
    const rects = result.pages.flatMap((p) => p.items).filter((i) => i.type === 'rect');
    // Distinct left edges = distinct columns; a 3-column table yields 3 x-positions.
    const xs = new Set(rects.map((r) => (r.type === 'rect' ? r.x : 0)));
    expect(xs.size).toBe(table.rows[0].cells.length);
  });
});

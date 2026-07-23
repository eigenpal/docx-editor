// Table layout (document-engine section 8 / fidelity slice 1): a structural table
// lays out into per-cell text plus border/shading rects, and does not crash the
// paragraph-only layout path.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { layoutBody, DeterministicMetrics, type LayoutOptions } from '../src/index.ts';
import { parseDocx, bodyStoryId, type TableRecord } from '@docx-editor.dev/engine-core';

function opts(over: Partial<LayoutOptions> = {}): LayoutOptions {
  return { pageWidth: 12240, pageHeight: 15840, margin: 1440, metrics: new DeterministicMetrics(), ...over };
}

function withTablesModel() {
  const bytes = readFileSync(`${import.meta.dir}/../../../e2e/fixtures/with-tables.docx`);
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

  test('column widths come from the grid when present', () => {
    const model = withTablesModel();
    const table = model.stories.get(bodyStoryId(model))!.blocks.find((b) => b.kind === 'table') as TableRecord;
    const result = layoutBody(model, opts());
    const rects = result.pages.flatMap((p) => p.items).filter((i) => i.type === 'rect');
    // Distinct left edges = distinct columns; a 3-column table yields 3 x-positions.
    const xs = new Set(rects.map((r) => (r.type === 'rect' ? r.x : 0)));
    expect(xs.size).toBe(table.rows[0].cells.length);
  });
});

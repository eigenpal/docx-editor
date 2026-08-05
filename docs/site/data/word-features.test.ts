import { describe, expect, test } from 'bun:test';
import { wordFeatures } from './word-features.ts';

function feature(id: string) {
  const row = wordFeatures.find((f) => f.id === id);
  if (!row) throw new Error(`missing feature row: ${id}`);
  return row;
}

describe('word-features — images lane honesty', () => {
  test('inline and anchored editing is partial with React-only note until Vue follow-up', () => {
    for (const id of ['images.inline', 'images.anchored'] as const) {
      const row = feature(id);
      expect(row.editing).toBe('partial');
      expect(row.rendering).toBe('full');
      expect(row.roundTrip).toBe('full');
      expect(row.notes?.toLowerCase()).toContain('vue');
    }
  });

  test('raster decode/paint is full for inline and anchored rows', () => {
    expect(feature('images.inline').rendering).toBe('full');
    expect(feature('images.anchored').rendering).toBe('full');
  });

  test('legacy and undecodable formats are preserved with placeholder rendering, not full paint', () => {
    const wmf = feature('images.wmf');
    expect(wmf.rendering).toBe('partial');
    expect(wmf.roundTrip).toBe('full');
    expect(wmf.editing).toBe('none');
    expect(wmf.notes?.toLowerCase()).toMatch(/placeholder|converter/);
  });

  test('SVG renders but is not claimed as insertable', () => {
    const svg = feature('images.svg');
    expect(svg.rendering).toBe('full');
    expect(svg.roundTrip).toBe('full');
    expect(svg.editing).toBe('none');
    expect(svg.notes?.toLowerCase()).toContain('insert');
  });

  test('unsupported non-picture payloads are preserved inertly, not claimed as supported', () => {
    for (const id of ['images.charts', 'images.smartart', 'images.shapes', 'images.textboxes'] as const) {
      const row = feature(id);
      expect(row.editing).toBe('none');
      expect(row.rendering).toBe('partial');
      expect(row.roundTrip).toBe('preserved');
      expect(row.notes?.toLowerCase()).toMatch(/placeholder|preserv|generic|inert/);
    }
  });

  test('tracked image revision is not claimed as editable or rendered', () => {
    const row = feature('images.tracked');
    expect(row.editing).toBe('none');
    expect(row.rendering).toBe('preserved');
    expect(row.roundTrip).toBe('preserved');
  });

  test('crop renders fully; React-only properties editing is partial', () => {
    const row = feature('images.crop');
    expect(row.rendering).toBe('full');
    expect(row.editing).toBe('partial');
    expect(row.roundTrip).toBe('full');
  });
});

import { describe, expect, test } from 'bun:test';
import { FEATURE_TIERS, wordFeatures } from './word-features.ts';

function feature(id: string) {
  const row = wordFeatures.find((f) => f.id === id);
  if (!row) throw new Error(`missing feature row: ${id}`);
  return row;
}

describe('word-features — the matrix itself', () => {
  test('every row declares a tier this site can render', () => {
    // A `tier: 'pro'` shipped here because no typecheck project included this file. The union
    // is the type gate; this is the one the suite runs.
    const tiers = new Set<string>(FEATURE_TIERS);
    const invalid = wordFeatures
      .filter((row) => !tiers.has(row.tier))
      .map((row) => `${row.id}: ${String(row.tier)}`);
    expect(invalid).toEqual([]);
  });

  test('every row has a unique id, so `feature()` cannot silently read the wrong row', () => {
    const ids = wordFeatures.map((row) => row.id);
    expect(ids.length).toBe(new Set(ids).size);
  });
});

describe('word-features — images lane honesty', () => {
  test('inline and anchored editing is partial in both adapters', () => {
    for (const id of ['images.inline', 'images.anchored'] as const) {
      const row = feature(id);
      expect(row.editing).toBe('partial');
      expect(row.rendering).toBe('full');
      expect(row.roundTrip).toBe('full');
      expect(row.notes?.toLowerCase()).toContain('both');
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
    for (const id of [
      'images.charts',
      'images.smartart',
      'images.shapes',
      'images.textboxes',
    ] as const) {
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

describe('word-features — lossless round-trip contract', () => {
  test('every tracked construct is full or preserved on round-trip', () => {
    for (const row of wordFeatures) {
      expect(['full', 'preserved']).toContain(row.roundTrip);
    }
  });

  test('inert constructs proven by the focused preservation fixture stay marked preserved', () => {
    for (const id of [
      'lists.picture-bullets',
      'images.effects',
      'images.ink',
      'layout.background',
      'fields.citations',
      'fields.legacy-forms',
      'structure.ole',
    ]) {
      expect(feature(id).roundTrip).toBe('preserved');
    }
    expect(feature('images.adjustments').roundTrip).toBe('full');
  });
});

// Deterministic layout + display-list tests (document-engine section 8 core,
// gate 9). Verifies anchored DisplayItem[] emission, line wrapping, pagination by
// height, and byte-identical output across repeated ("cross-runtime") runs.

import { describe, expect, test } from 'bun:test';
import { layoutBody, hitTest, DeterministicMetrics, type LayoutOptions } from '../src/index.ts';
import {
  createEmptyModel,
  bodyStoryId,
  DocumentStore,
  ORIGIN_IDS,
  fingerprint,
  type ParagraphRecord,
} from '@docx-editor.dev/engine-core';

const HUMAN = ORIGIN_IDS.mutationHuman;

function opts(over: Partial<LayoutOptions> = {}): LayoutOptions {
  return { pageWidth: 12240, pageHeight: 15840, margin: 1440, metrics: new DeterministicMetrics(), ...over };
}

function modelWith(paragraphs: string[]) {
  const model = createEmptyModel();
  const storyId = bodyStoryId(model);
  const store = new DocumentStore(model);
  const p1 = (model.stories.get(storyId)!.blocks[0] as ParagraphRecord).id;
  store.transact(HUMAN, (c) => c.apply({ op: 'insertText', paragraphId: p1, text: paragraphs[0] }));
  for (let i = 1; i < paragraphs.length; i++) {
    const r = store.transact(HUMAN, (c) => c.apply({ op: 'appendParagraph', storyId }));
    const pid = r.ok ? r.modelChange.created[0] : '';
    store.transact(HUMAN, (c) => c.apply({ op: 'insertText', paragraphId: pid, text: paragraphs[i] }));
  }
  return store.currentModel;
}

describe('display-list emission', () => {
  test('emits anchored text items with fixed-point geometry', () => {
    const result = layoutBody(modelWith(['Hello world']), opts());
    const items = result.pages[0].items;
    expect(items).toHaveLength(2); // "Hello" and "world"
    expect(items[0]).toMatchObject({ type: 'text', text: 'Hello', x: 1440, y: 1440 });
    expect(items[0].anchor).toMatchObject({ paragraphId: expect.any(String), offset: 0 });
    expect(items[1].anchor.offset).toBe(6); // "Hello " = 6 chars
    expect(Number.isInteger(items[1].x)).toBe(true); // integer geometry
  });

  test('long text wraps to new lines within a page', () => {
    // Many words on a narrow page force multiple lines.
    const words = Array.from({ length: 30 }, (_, i) => `word${i}`).join(' ');
    const result = layoutBody(modelWith([words]), opts({ pageWidth: 4000 }));
    const ys = new Set(result.pages[0].items.map((i) => i.y));
    expect(ys.size).toBeGreaterThan(1); // wrapped onto multiple lines
  });

  test('content taller than one page paginates', () => {
    const many = Array.from({ length: 200 }, (_, i) => `line ${i}`);
    const result = layoutBody(modelWith(many), opts());
    expect(result.pages.length).toBeGreaterThan(1);
    expect(result.status).toBe('converged');
  });
});

describe('cross-runtime determinism (gate 9)', () => {
  test('the same model + ports yield byte-identical pages every run', () => {
    const model = modelWith(['The quick brown fox', 'jumps over the lazy dog']);
    const a = layoutBody(model, opts());
    const b = layoutBody(model, opts());
    // Exact display-list fingerprints match (this is what browser/worker/server compare).
    expect(fingerprint('paginationFingerprint', a)).toBe(fingerprint('paginationFingerprint', b));
    expect(a).toEqual(b);
  });

  test('geometry is exact — a text change alters the fingerprint', () => {
    const base = fingerprint('paginationFingerprint', layoutBody(modelWith(['abc']), opts()));
    const changed = fingerprint('paginationFingerprint', layoutBody(modelWith(['abcd']), opts()));
    expect(changed).not.toBe(base);
  });
});

describe('hit-testing from the display list (8.9)', () => {
  test('a point over a word resolves to its anchor + refined offset', () => {
    const metrics = new DeterministicMetrics();
    const result = layoutBody(modelWith(['Hello world']), opts({ metrics }));
    const second = result.pages[0].items[1]; // "world"
    // A point inside "world" resolves back to its paragraph + offset 6.
    const anchor = hitTest(result, 0, second.x + 5, second.y + 10, metrics);
    expect(anchor).toMatchObject({ offset: 6 });
    // A point in empty space returns nothing.
    expect(hitTest(result, 0, 100000, 100000, metrics)).toBeUndefined();
  });
});

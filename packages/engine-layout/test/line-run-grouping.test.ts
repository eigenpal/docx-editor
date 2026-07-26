// Line-clipped paint runs (renderer run grouping, phase 2).
//
// The renderer used to emit one TextItem per WORD, split again at style boundaries, so
// element count scaled with word count. These pin the replacement: authored runs clipped
// to each VISUAL LINE, so element count scales with lines x style changes.
//
// The invariants that must NOT move are asserted alongside the count, because a lower
// item count proves nothing on its own — the same text has to land at the same
// coordinates.

import { describe, expect, test } from 'bun:test';
import { createEmptyModel, bodyStoryId, DocumentStore, ORIGIN_IDS } from '@docx-editor.dev/engine-core';
import { layoutBody } from '../src/layout.ts';
import { HelveticaMetrics } from '../src/metrics.ts';
import type { ParagraphRecord, RunProps } from '@docx-editor.dev/engine-core';
import type { TextItem } from '../src/display-item.ts';

const WIDE = { pageWidth: 12240, pageHeight: 15840, margin: 1440, metrics: new HelveticaMetrics() };
// Narrow enough that a sentence wraps several times.
const NARROW = { pageWidth: 2800, pageHeight: 15840, margin: 1440, metrics: new HelveticaMetrics() };
const HUMAN = ORIGIN_IDS.mutationHuman;

function layoutRuns(runs: readonly { text: string; props?: RunProps }[], layout = WIDE) {
  const model = createEmptyModel();
  const storyId = bodyStoryId(model);
  const store = new DocumentStore(model);
  const first = (model.stories.get(storyId)!.blocks[0] as ParagraphRecord).id;
  store.transact(HUMAN, (c) =>
    c.apply({
      op: 'setParagraphRuns',
      paragraphId: first,
      runs: runs.map((r) => (r.props ? { text: r.text, props: r.props } : { text: r.text })),
    }),
  );
  return layoutBody(store.currentModel, layout);
}

const textItems = (result: ReturnType<typeof layoutBody>): TextItem[] =>
  result.pages.flatMap((p) => p.items.filter((i): i is TextItem => i.type === 'text'));

/** Text as painted, per visual line, in x order — the wrapping/text invariant. */
function linesOf(items: TextItem[]): string[] {
  const byLine = new Map<string, TextItem[]>();
  for (const item of items) {
    const bucket = byLine.get(item.line.lineId) ?? [];
    bucket.push(item);
    byLine.set(item.line.lineId, bucket);
  }
  return [...byLine.values()].map((bucket) =>
    bucket.sort((a, b) => a.x - b.x).map((i) => i.text).join(''),
  );
}

describe('paint runs are clipped to visual lines, not to words', () => {
  test('a single-style line paints as ONE item regardless of word count', () => {
    const sentence = 'one two three four five six seven eight';
    const items = textItems(layoutRuns([{ text: sentence }]));

    // The whole sentence fits one line at this width, so it is one paint run.
    expect(items).toHaveLength(1);
    expect(items[0]!.text).toBe(sentence);
  });

  test('SPACES are real text in the paint projection', () => {
    // The previous renderer advanced the cursor over whitespace and emitted nothing, so
    // painted text had no spaces at all and native selection had gaps.
    const items = textItems(layoutRuns([{ text: 'alpha beta' }]));
    expect(items.map((i) => i.text).join('')).toBe('alpha beta');
  });

  test('repeated spaces, tabs and leading/trailing whitespace survive verbatim', () => {
    const text = '  double  spaced\tand\ttabbed  ';
    const items = textItems(layoutRuns([{ text }]));
    expect(items.map((i) => i.text).join('')).toBe(text);
  });

  test('a run is split at LINE boundaries and each piece keeps its formatting', () => {
    // One authored bold run long enough to wrap several times.
    const long = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ');
    const items = textItems(layoutRuns([{ text: long, props: { bold: true } }], NARROW));

    expect(items.length).toBeGreaterThan(1); // it wrapped
    expect(items.every((i) => i.bold)).toBe(true); // every piece kept the formatting
    // One item per line: no line carries two pieces of the same style.
    const perLine = new Map<string, number>();
    for (const item of items) perLine.set(item.line.lineId, (perLine.get(item.line.lineId) ?? 0) + 1);
    expect([...perLine.values()].every((n) => n === 1)).toBe(true);
  });

  test('grouping stops at a style change — adjacent runs never merge', () => {
    const items = textItems(
      layoutRuns([
        { text: 'plain ' },
        { text: 'bold', props: { bold: true } },
        { text: ' plain again' },
      ]),
    );
    expect(items).toHaveLength(3);
    expect(items.map((i) => i.text)).toEqual(['plain ', 'bold', ' plain again']);
    expect(items.map((i) => i.bold)).toEqual([false, true, false]);
  });

  test('a run boundary INSIDE a word is not a wrapping opportunity', () => {
    // "un|break|able" is one word authored as three runs. It must stay on one line and
    // paint as three items, not wrap between them.
    const items = textItems(
      layoutRuns([
        { text: 'un' },
        { text: 'break', props: { italic: true } },
        { text: 'able' },
      ]),
    );
    expect(items.map((i) => i.text)).toEqual(['un', 'break', 'able']);
    expect(new Set(items.map((i) => i.line.lineId)).size).toBe(1);
  });

  test('items are laid out left to right with no overlap and no gap', () => {
    // Contiguous x is what makes native selection across a line gap-free.
    const items = textItems(
      layoutRuns([{ text: 'alpha ' }, { text: 'beta', props: { bold: true } }, { text: ' gamma' }]),
    );
    const sorted = [...items].sort((a, b) => a.x - b.x);
    for (let i = 1; i < sorted.length; i += 1) {
      const prevRight = sorted[i - 1]!.x + sorted[i - 1]!.width;
      expect(Math.abs(sorted[i]!.x - prevRight)).toBeLessThanOrEqual(1);
    }
  });

  test('wrapping and text are unchanged by grouping', () => {
    // The invariant the baseline records: same words on same lines.
    const sentence = Array.from({ length: 40 }, (_, i) => `w${i}`).join(' ');
    const lines = linesOf(textItems(layoutRuns([{ text: sentence }], NARROW)));
    expect(lines.join(' ').replace(/\s+/g, ' ').trim()).toBe(sentence);
    expect(lines.length).toBeGreaterThan(1);
  });

  test('each item anchors at its own paragraph offset', () => {
    // Semantic provenance must survive grouping: an item's anchor is where its text
    // starts in the paragraph, so hit testing and selection stay addressable.
    const items = textItems(
      layoutRuns([{ text: 'alpha ' }, { text: 'beta', props: { bold: true } }]),
    );
    const sorted = [...items].sort((a, b) => a.x - b.x);
    let expected = 0;
    for (const item of sorted) {
      expect(item.anchor.offset).toBe(expected);
      expected += item.text.length;
    }
  });
});

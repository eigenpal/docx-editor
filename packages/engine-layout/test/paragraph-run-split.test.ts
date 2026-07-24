// Paragraph run-split layout invariant tests (task 5.5 review).

import { describe, expect, test } from 'bun:test';
import { createEmptyModel, bodyStoryId, DocumentStore, ORIGIN_IDS } from '@docx-editor.dev/engine-core';
import { layoutBody } from '../src/layout.ts';
import { HelveticaMetrics } from '../src/metrics.ts';
import type { ParagraphRecord } from '@docx-editor.dev/engine-core';
import type { CaretEdgeItem, TextItem } from '../src/display-item.ts';

const LAYOUT = { pageWidth: 2800, pageHeight: 15840, margin: 1440, metrics: new HelveticaMetrics() };
const HUMAN = ORIGIN_IDS.mutationHuman;

function paragraphLayout(text: string, runs: string[]) {
  const model = createEmptyModel();
  const storyId = bodyStoryId(model);
  const store = new DocumentStore(model);
  const first = (model.stories.get(storyId)!.blocks[0] as ParagraphRecord).id;
  store.transact(HUMAN, (c) =>
    c.apply({
      op: 'setParagraphRuns',
      paragraphId: first,
      runs: runs.map((part) => ({ text: part })),
    }),
  );
  void text;
  return layoutBody(store.currentModel, LAYOUT);
}

function signature(pages: ReturnType<typeof layoutBody>['pages']) {
  const edges = pages.flatMap((p) => p.items.filter((i): i is CaretEdgeItem => i.type === 'caretEdge' && i.navigable));
  const texts = pages.flatMap((p) => p.items.filter((i): i is TextItem => i.type === 'text'));
  const lineIds = [...new Set(edges.map((e) => e.line.lineId))].sort();
  const breakOffsets = edges.filter((e) => e.graphemeOffset === 0 || edges.some((o) => o.line.lineId !== e.line.lineId)).map((e) => e.graphemeOffset);
  return {
    lineCount: lineIds.length,
    lineIds,
    edgeOffsets: edges.map((e) => e.graphemeOffset),
    edgeXs: edges.map((e) => e.x),
    textAnchors: texts.map((t) => ({ offset: t.anchor.offset, len: t.text.length, lineId: t.line.lineId })),
  };
}

describe('paragraph run-split invariant (task 5.5 review)', () => {
  test('narrow x abcdef unsplit matches runs x ab + cdef for lines, ids, and caret edges', () => {
    const unsplit = paragraphLayout('x abcdef', ['x ', 'abcdef']);
    const split = paragraphLayout('x abcdef', ['x ab', 'cdef']);
    const boldSplit = paragraphLayout('x abcdef', ['x ', 'abc', 'def']);
    const a = signature(unsplit.pages);
    const b = signature(split.pages);
    const c = signature(boldSplit.pages);
    expect(b.lineCount).toBe(a.lineCount);
    expect(c.lineCount).toBe(a.lineCount);
    expect(b.lineIds).toEqual(a.lineIds);
    expect(c.lineIds).toEqual(a.lineIds);
    expect(b.edgeOffsets).toEqual(a.edgeOffsets);
    expect(c.edgeOffsets).toEqual(a.edgeOffsets);
    expect(b.edgeXs).toEqual(a.edgeXs);
    expect(c.edgeXs).toEqual(a.edgeXs);
  });
});

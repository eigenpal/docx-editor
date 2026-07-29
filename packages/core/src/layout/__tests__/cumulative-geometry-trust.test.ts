// Cumulative geometry trust from line origin (task 5.5 review).

import { describe, expect, test } from 'bun:test';
import {
  createEmptyModel,
  bodyStoryId,
  DocumentStore,
  ORIGIN_IDS,
  type ParagraphRecord,
} from '@docx-editor.dev/core-contract/store';
import { createDeterministicLayoutShaping, layoutBody, type CaretEdgeItem } from '../index.ts';

const LAYOUT = {
  pageWidth: 12240,
  pageHeight: 15840,
  margin: 1440,
  shaping: createDeterministicLayoutShaping(),
};
const HUMAN = ORIGIN_IDS.mutationHuman;

function navigableOffsets(text: string): number[] {
  const model = createEmptyModel();
  const storyId = bodyStoryId(model);
  const store = new DocumentStore(model);
  const pid = (model.stories.get(storyId)!.blocks[0] as ParagraphRecord).id;
  store.transact(HUMAN, (c) => c.apply({ op: 'insertText', paragraphId: pid, text }));
  const pages = layoutBody(store.currentModel, LAYOUT).pages;
  const offsets = pages
    .flatMap((p) => p.items)
    .filter((item): item is CaretEdgeItem => item.type === 'caretEdge' && item.navigable)
    .map((edge) => edge.graphemeOffset);
  return [...new Set(offsets)].sort((a, b) => a - b);
}

describe('cumulative geometry trust (task 5.5 review)', () => {
  test('shaped clusters publish exact geometry for non-ASCII graphemes', () => {
    expect(navigableOffsets('😀')).toEqual([0, 1]);
    expect(navigableOffsets('a😀')).toEqual([0, 1, 2]);
    expect(navigableOffsets('a😀b')).toEqual([0, 1, 2, 3]);
  });
});

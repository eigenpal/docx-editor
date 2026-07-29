// The shape of the published caret-stop array (renderer run grouping, incremental phase).
//
// `semanticIndex.caretStops` holds ONE ENTRY PER GRAPHEME in the document — 106,907 on the
// 24-page styled fixture — and both consumers scan it linearly. Two attempts to index it
// were measured as net losses (a full key map costs 52.65 ms to build, a per-block summary
// 10.8 ms, against a 0.84 ms scan) because a frame is published on every keystroke while
// only one or two stops are queried per frame.
//
// So the array stays authoritative and unindexed, and these pin the regularity that makes
// a compact replacement possible later: exactly one stop per offset in `[0, graphemeCount]`,
// all `editableText`, and NONE at all for a read-only block. A change here is the signal
// that per-grapheme caret stops can be replaced with a per-block range.

import { describe, expect, test } from 'bun:test';
import type { InteractionFrame, SemanticTarget } from '@docx-editor.dev/core-contract/contracts/interaction';
import { hitTestPointer } from '../interaction-geometry.ts';
import { buildSemanticIndex } from '../semantic-index.ts';
import { publishFrame, modelWith, modelWithTableCell } from './interaction-test-helpers.ts';

/**
 * Role the published array reports for a target, by the predicate the old code used.
 * This is the oracle: it reads the real `caretStops`, never the derivation.
 */
function publishedRole(frame: InteractionFrame, target: Extract<SemanticTarget, { kind: 'text' }>) {
  return frame.semanticIndex.caretStops.find(
    (s) =>
      s.target.kind === 'text' &&
      s.target.identity.blockId === target.identity.blockId &&
      s.target.graphemeOffset === target.graphemeOffset &&
      s.target.affinity === target.affinity
  )?.role;
}

describe('published caret stops are a regular per-block range', () => {
  const texts = ['ab cd', '', '   ', 'a\tb', 'hello world of text', 'é 👍 日本', 'مرحبا سلام'];

  test('every published stop is derivable, and nothing else is', () => {
    for (const text of texts) {
      const frame = publishFrame(modelWith([text]));
      const block = frame.semanticIndex.stories[0]!.blocks[0]!;
      const published = frame.semanticIndex.caretStops.filter(
        (s) => s.target.kind === 'text' && s.target.identity.blockId === block.identity.blockId
      );
      // The rule: one stop per offset in [0, graphemeCount], role editableText.
      expect(published).toHaveLength(block.graphemeCount + 1);
      expect(published.every((s) => s.role === 'editableText')).toBe(true);
      const offsets = published.map(
        (s) => (s.target as Extract<SemanticTarget, { kind: 'text' }>).graphemeOffset
      );
      expect(offsets).toEqual(Array.from({ length: block.graphemeCount + 1 }, (_, i) => i));
      // And nothing outside the range.
      for (const outside of [-1, block.graphemeCount + 1, block.graphemeCount + 7]) {
        expect(
          published.some(
            (s) =>
              (s.target as Extract<SemanticTarget, { kind: 'text' }>).graphemeOffset === outside
          )
        ).toBe(false);
      }
    }
  });

  test('a read-only block publishes no caret stops at all', () => {
    const index = buildSemanticIndex(modelWithTableCell('a b'), { kind: 'body' });
    const cellStops = index.caretStops.filter(
      (s) => s.target.kind === 'text' && s.target.identity.blockId === 'p-cell'
    );
    expect(cellStops).toHaveLength(0);
  });

  test('hit testing on a read-only block still reports selectableText', () => {
    const frame = publishFrame(modelWithTableCell('a b'));
    const item = frame.display
      .flatMap((p) => p.items)
      .find((i) => i.kind === 'text' && i.semantic.identity.blockId === 'p-cell');
    if (item?.kind !== 'text') throw new Error('cell item');
    const cluster = item.clusters[0];
    if (!cluster) throw new Error('cluster');
    const page = frame.pageGeometry[0]!;
    const hit = hitTestPointer(
      frame,
      { x: page.box.x + cluster.box.x + 1, y: page.box.y + cluster.box.y + cluster.box.height / 2 },
      { clientOrigin: { x: 0, y: 0 }, scrollOffset: { x: 0, y: 0 }, zoom: 1 }
    );
    expect(hit.ok).toBe(true);
    if (!hit.ok) throw new Error('hit');
    expect(hit.value.role).toBe('selectableText');
  });

  test('an editable block reports editableText at a canonical stop', () => {
    const frame = publishFrame(modelWith(['ab cd']));
    const block = frame.semanticIndex.stories[0]!.blocks[0]!;
    const target: Extract<SemanticTarget, { kind: 'text' }> = {
      kind: 'text',
      scope: { kind: 'body' },
      identity: block.identity,
      graphemeOffset: 2,
      affinity: 'upstream',
    };
    expect(publishedRole(frame, target)).toBe('editableText');
  });
});

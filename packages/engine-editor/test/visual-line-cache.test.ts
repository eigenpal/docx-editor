// Per-paragraph reuse of visual lines (incremental bridge phase).
//
// Navigation geometry was the last per-grapheme graph rebuilt on every layout: 106,539
// caret edges constructed and then frozen, against 1,383 painted items. A paragraph's edges
// are emitted by the same layout walk that positions its painted slices, so if every slice
// is identical in text, geometry, page and role, the edges are identical too.
//
// The reuse must be INVISIBLE. These pin equivalence against an uncached build first,
// because a cache that changes output is worse than no cache, and only then the reuse.

import { describe, expect, test } from 'bun:test';
import { layoutBody, HelveticaMetrics } from '@docx-editor.dev/engine-layout';
import {
  createEmptyModel,
  bodyStoryId,
  DocumentStore,
  ORIGIN_IDS,
  type PackageModel,
  type ParagraphRecord,
} from '@docx-editor.dev/engine-core';
import { DisplayBridgeCache, toDisplayPages } from '../src/display-bridge.ts';
import { LAYOUT } from './interaction-test-helpers.ts';

const HUMAN = ORIGIN_IDS.mutationHuman;

function storeWith(texts: readonly string[]) {
  const model = createEmptyModel();
  const storyId = bodyStoryId(model);
  const store = new DocumentStore(model);
  const first = (model.stories.get(storyId)!.blocks[0] as ParagraphRecord).id;
  store.transact(HUMAN, (c) => c.apply({ op: 'insertText', paragraphId: first, text: texts[0] ?? '' }));
  const ids = [first];
  for (let i = 1; i < texts.length; i += 1) {
    const r = store.transact(HUMAN, (c) => c.apply({ op: 'appendParagraph', storyId }));
    const pid = r.ok ? r.modelChange.created[0]! : first;
    store.transact(HUMAN, (c) => c.apply({ op: 'insertText', paragraphId: pid, text: texts[i]! }));
    ids.push(pid);
  }
  return { store, ids, storyId };
}

const bridge = (model: PackageModel, cache?: DisplayBridgeCache) => {
  const metrics = new HelveticaMetrics();
  return toDisplayPages(model, layoutBody(model, { ...LAYOUT, metrics }).pages, metrics, cache);
};

/** Every field navigation geometry publishes, as comparable data. */
const navShape = (r: ReturnType<typeof bridge>) =>
  JSON.stringify({
    lines: r.navigationGeometry.visualLines.map((l) => ({
      identity: l.identity,
      pageIndex: l.pageIndex,
      line: l.line,
      lineOrder: l.lineOrder,
      fragmentOrder: l.fragmentOrder,
      interaction: l.interaction,
      lineBox: l.lineBox,
      edges: l.edges,
    })),
    traversal: r.navigationGeometry.traversalByBlockId,
    shapingSupported: r.navigationGeometry.shapingSupported,
    boundaries: r.navigationGeometry.semanticHorizontalBoundariesByBlockId,
    conflicts: r.navigationGeometry.paintFragmentConflicts,
  });

const TEXTS = [
  ['alpha beta gamma', 'delta epsilon zeta', 'eta theta'],
  ['one', '', '   ', 'tab\there', 'a b  c'],
  ['x'.repeat(400), 'short', 'wrapped '.repeat(60)],
  ['café 日本 مرحبا', '👍 🙂', 'é combining'],
];

describe('visual line reuse is invisible', () => {
  test('cached and uncached navigation geometry are identical on first build', () => {
    for (const texts of TEXTS) {
      const { store } = storeWith(texts);
      expect(navShape(bridge(store.currentModel, new DisplayBridgeCache()))).toBe(
        navShape(bridge(store.currentModel)),
      );
    }
  });

  test('after an edit, a warm cache still matches a cold uncached build', () => {
    for (const texts of TEXTS) {
      const { store, ids } = storeWith(texts);
      const cache = new DisplayBridgeCache();
      bridge(store.currentModel, cache); // warm
      store.transact(HUMAN, (c) =>
        c.apply({ op: 'insertText', paragraphId: ids[0]!, offset: 0, text: 'Z' }),
      );
      expect(navShape(bridge(store.currentModel, cache))).toBe(navShape(bridge(store.currentModel)));
    }
  });

  test('inserting a paragraph renumbers lineOrder even where lines are reused', () => {
    // lineOrder/fragmentOrder are running counters assigned after a global sort, so they
    // must be re-stamped rather than reused with the chunk.
    const { store, ids, storyId } = storeWith(['first line', 'second line']);
    const cache = new DisplayBridgeCache();
    const before = bridge(store.currentModel, cache);
    const beforeOrder = before.navigationGeometry.visualLines.find(
      (l) => l.identity.blockId === ids[1]!,
    )!.lineOrder;

    store.transact(HUMAN, (c) => c.apply({ op: 'insertParagraph', storyId, index: 0, runs: [] }));
    const after = bridge(store.currentModel, cache);
    const afterOrder = after.navigationGeometry.visualLines.find(
      (l) => l.identity.blockId === ids[1]!,
    )!.lineOrder;

    expect(afterOrder).toBeGreaterThan(beforeOrder);
    expect(navShape(after)).toBe(navShape(bridge(store.currentModel)));
  });

  test('a one-character edit rebuilds one paragraph and reuses the rest', () => {
    const { store, ids } = storeWith(['alpha beta', 'gamma delta', 'epsilon zeta', 'eta']);
    const cache = new DisplayBridgeCache();
    bridge(store.currentModel, cache);
    store.transact(HUMAN, (c) =>
      c.apply({ op: 'insertText', paragraphId: ids[2]!, offset: 0, text: 'q' }),
    );
    bridge(store.currentModel, cache);
    expect(cache.linesBuilt).toBe(1);
    expect(cache.linesReused).toBe(3);
  });

  test('a paragraph that MOVES is rebuilt, not reused at its old geometry', () => {
    const { store, ids } = storeWith(['short', 'second paragraph here']);
    const cache = new DisplayBridgeCache();
    const before = bridge(store.currentModel, cache);
    const beforeY = before.navigationGeometry.visualLines.find(
      (l) => l.identity.blockId === ids[1]!,
    )!.edges[0]!.pageLocalY;

    store.transact(HUMAN, (c) =>
      c.apply({ op: 'insertText', paragraphId: ids[0]!, offset: 0, text: 'w '.repeat(400) }),
    );
    const after = bridge(store.currentModel, cache);
    const movedY = after.navigationGeometry.visualLines.find(
      (l) => l.identity.blockId === ids[1]!,
    )!.edges[0]!.pageLocalY;
    expect(movedY).not.toBe(beforeY);
    expect(navShape(after)).toBe(navShape(bridge(store.currentModel)));
  });

  test('reused lines and their edges are frozen', () => {
    const { store } = storeWith(['alpha beta gamma']);
    const result = bridge(store.currentModel, new DisplayBridgeCache());
    for (const line of result.navigationGeometry.visualLines) {
      expect(Object.isFrozen(line.edges)).toBe(true);
      for (const edge of line.edges) expect(Object.isFrozen(edge)).toBe(true);
    }
  });
});

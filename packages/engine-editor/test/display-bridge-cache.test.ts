// Per-slice reuse of frozen clusters across layouts (incremental bridge phase).
//
// A one-character edit changes the geometry of at most a few lines, but the bridge rebuilt
// every cluster in the document and publication then walked all of them. These pin that
// unchanged slices reuse their frozen arrays BY IDENTITY, and — just as important — that a
// slice whose geometry or text actually changed does NOT.

import { describe, expect, test } from 'bun:test';
import { layoutBody } from '@docx-editor.dev/engine-layout';
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
  store.transact(HUMAN, (c) =>
    c.apply({ op: 'insertText', paragraphId: first, text: texts[0] ?? '' })
  );
  const ids = [first];
  for (let i = 1; i < texts.length; i += 1) {
    const r = store.transact(HUMAN, (c) => c.apply({ op: 'appendParagraph', storyId }));
    const pid = r.ok ? r.modelChange.created[0]! : first;
    store.transact(HUMAN, (c) => c.apply({ op: 'insertText', paragraphId: pid, text: texts[i]! }));
    ids.push(pid);
  }
  return { store, ids };
}

function bridge(model: PackageModel, cache?: DisplayBridgeCache) {
  return toDisplayPages(model, layoutBody(model, LAYOUT).pages, { cache });
}

function clustersByBlock(result: ReturnType<typeof bridge>) {
  const out = new Map<string, unknown>();
  for (const page of result.display) {
    for (const item of page.items) {
      if (item.kind !== 'text') continue;
      out.set(`${item.semantic.identity.blockId}:${item.semantic.utf16From}`, item.clusters);
    }
  }
  return out;
}

describe('display bridge reuses frozen clusters for unchanged slices', () => {
  test('editing one paragraph rebuilds only that paragraph', () => {
    const { store, ids } = storeWith(['alpha beta', 'gamma delta', 'epsilon zeta']);
    const cache = new DisplayBridgeCache();
    const before = bridge(store.currentModel, cache);
    expect(cache.built).toBeGreaterThan(0);
    expect(cache.reused).toBe(0);

    store.transact(HUMAN, (c) =>
      c.apply({ op: 'insertText', paragraphId: ids[1]!, offset: 0, text: 'x' })
    );
    const after = bridge(store.currentModel, cache);

    expect(cache.built).toBe(1);
    expect(cache.reused).toBeGreaterThan(0);

    const b = clustersByBlock(before);
    const a = clustersByBlock(after);
    // The untouched paragraphs keep the SAME cluster array object.
    for (const [key, clusters] of b) {
      if (key.startsWith(`${ids[1]!}:`)) continue;
      expect(a.get(key)).toBe(clusters);
    }
    // The edited paragraph does not.
    const editedKey = `${ids[1]!}:0`;
    expect(a.get(editedKey)).not.toBe(b.get(editedKey));
  });

  test('reused cluster arrays are already frozen, so publication cannot descend into them', () => {
    const { store } = storeWith(['alpha beta gamma']);
    const cache = new DisplayBridgeCache();
    const result = bridge(store.currentModel, cache);
    for (const page of result.display) {
      for (const item of page.items) {
        if (item.kind !== 'text') continue;
        expect(Object.isFrozen(item.clusters)).toBe(true);
        for (const cluster of item.clusters) expect(Object.isFrozen(cluster)).toBe(true);
      }
    }
  });

  test('a slice that MOVES is rebuilt, not reused at its old geometry', () => {
    // Growing the first paragraph past a wrap pushes the second down. Its text is
    // unchanged, so a content-only key would wrongly reuse clusters at the old y.
    const { store, ids } = storeWith(['short', 'second paragraph']);
    const cache = new DisplayBridgeCache();
    const before = bridge(store.currentModel, cache);
    const beforeY = before.display
      .flatMap((p) => p.items)
      .find((i) => i.kind === 'text' && i.semantic.identity.blockId === ids[1]!)!.box.y;

    store.transact(HUMAN, (c) =>
      c.apply({ op: 'insertText', paragraphId: ids[0]!, offset: 0, text: 'w '.repeat(400) })
    );
    const after = bridge(store.currentModel, cache);
    const moved = after.display
      .flatMap((p) => p.items)
      .find((i) => i.kind === 'text' && i.semantic.identity.blockId === ids[1]!)!;
    expect(moved.box.y).not.toBe(beforeY);
    for (const cluster of moved.clusters) expect(cluster.box.y).toBe(moved.box.y);
  });

  test('cached and uncached clusters are identical in CONTENT, not just in key set', () => {
    // The previous version of this test compared only the key set, so it would have passed
    // with every cluster wrong — and it did: review found the cache key omitted the
    // paragraph's caret-edge index and grapheme count, and a 500-step differential diverged
    // in 8 of 10 seeds with missing clusters, extra clusters and wrong widths.
    const shape = (r: ReturnType<typeof bridge>) =>
      JSON.stringify(
        r.display.map((page) =>
          page.items
            .filter((i) => i.kind === 'text')
            .map((i) => (i.kind === 'text' ? { s: i.semantic, c: i.clusters, b: i.box } : null))
        )
      );
    const { store, ids } = storeWith(['alpha beta', 'gamma delta']);
    expect(shape(bridge(store.currentModel, new DisplayBridgeCache()))).toBe(
      shape(bridge(store.currentModel))
    );

    // And after edits, against a warm cache — the shape review actually broke.
    const cache = new DisplayBridgeCache();
    bridge(store.currentModel, cache);
    for (const text of ['x'.repeat(30), 'y', ' ', 'zz ']) {
      store.transact(HUMAN, (c) =>
        c.apply({ op: 'insertText', paragraphId: ids[0]!, offset: 0, text })
      );
      expect(shape(bridge(store.currentModel, cache))).toBe(shape(bridge(store.currentModel)));
    }
  });

  test('a trailing styled space at a wrap stays consistent across edits', () => {
    // The exact reproduction review reported: a bold trailing space whose cluster is
    // correctly dropped once the wrap offset gains an edge at the next line's left margin.
    const model = createEmptyModel();
    const storyId = bodyStoryId(model);
    const store = new DocumentStore(model);
    const first = (model.stories.get(storyId)!.blocks[0] as ParagraphRecord).id;
    store.transact(HUMAN, (c) =>
      c.apply({
        op: 'setParagraphRuns',
        paragraphId: first,
        runs: [{ text: 'wrap '.repeat(12) }, { text: ' ', props: { bold: true } }],
      })
    );
    const shape = (r: ReturnType<typeof bridge>) =>
      JSON.stringify(
        r.display.flatMap((p) =>
          p.items.filter((i) => i.kind === 'text').map((i) => (i.kind === 'text' ? i.clusters : []))
        )
      );
    const cache = new DisplayBridgeCache();
    bridge(store.currentModel, cache);
    store.transact(HUMAN, (c) =>
      c.apply({ op: 'insertText', paragraphId: first, offset: 0, text: 'x'.repeat(30) })
    );
    expect(shape(bridge(store.currentModel, cache))).toBe(shape(bridge(store.currentModel)));
  });
});

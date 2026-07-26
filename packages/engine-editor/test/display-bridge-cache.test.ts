// Per-slice reuse of frozen clusters across layouts (incremental bridge phase).
//
// A one-character edit changes the geometry of at most a few lines, but the bridge rebuilt
// every cluster in the document and publication then walked all of them. These pin that
// unchanged slices reuse their frozen arrays BY IDENTITY, and — just as important — that a
// slice whose geometry or text actually changed does NOT.

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
  return { store, ids };
}

function bridge(model: PackageModel, cache?: DisplayBridgeCache) {
  const metrics = new HelveticaMetrics();
  return toDisplayPages(model, layoutBody(model, { ...LAYOUT, metrics }).pages, metrics, cache);
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

    store.transact(HUMAN, (c) => c.apply({ op: 'insertText', paragraphId: ids[1]!, offset: 0, text: 'x' }));
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
      c.apply({ op: 'insertText', paragraphId: ids[0]!, offset: 0, text: 'w '.repeat(400) }),
    );
    const after = bridge(store.currentModel, cache);
    const moved = after.display
      .flatMap((p) => p.items)
      .find((i) => i.kind === 'text' && i.semantic.identity.blockId === ids[1]!)!;
    expect(moved.box.y).not.toBe(beforeY);
    for (const cluster of moved.clusters) expect(cluster.box.y).toBe(moved.box.y);
  });

  test('without a cache the bridge is unchanged and builds every slice', () => {
    const { store } = storeWith(['alpha beta', 'gamma delta']);
    const withCache = bridge(store.currentModel, new DisplayBridgeCache());
    const without = bridge(store.currentModel);
    const a = [...clustersByBlock(withCache).keys()].sort();
    const b = [...clustersByBlock(without).keys()].sort();
    expect(a).toEqual(b);
  });
});

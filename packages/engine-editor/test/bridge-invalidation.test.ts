// `toDisplayPages` consumes created/changed/deleted block ids (ordered work step 3).
//
// The ids are used for EVICTION ONLY, and that is the whole safety argument. A dirty-id list
// says which blocks the user edited; it cannot say which blocks MOVED, because inserting a
// line reflows everything below it while those ids stay clean. Fingerprints catch both and
// remain what decides reuse. Dirty ids may only take cache entries AWAY — they can cost a
// rebuild and can never cause stale geometry to be served.
//
// So these assert two things: that passing ids evicts, and that passing WRONG ids (or none)
// still produces output identical to a cold build.

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
import { DisplayBridgeCache, toDisplayPages, type BridgeInvalidation } from '../src/display-bridge.ts';
import { LAYOUT } from './interaction-test-helpers.ts';

const HUMAN = ORIGIN_IDS.mutationHuman;
const metrics = new HelveticaMetrics();

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

const bridge = (model: PackageModel, cache?: DisplayBridgeCache, invalidation?: BridgeInvalidation) =>
  toDisplayPages(model, layoutBody(model, { ...LAYOUT, metrics }).pages, metrics, cache, invalidation);

const shape = (r: ReturnType<typeof bridge>) =>
  JSON.stringify({
    items: r.display.map((p) =>
      p.items.filter((i) => i.kind === 'text').map((i) => (i.kind === 'text' ? { s: i.semantic, c: i.clusters, b: i.box } : null)),
    ),
    nav: r.navigationGeometry.visualLines.map((l) => ({ id: l.identity, edges: l.edges, box: l.lineBox })),
    stops: r.semanticIndex.caretStops.length,
  });

describe('bridge consumes dirty block ids', () => {
  test('naming a block as changed evicts its cached chunks', () => {
    const { store, ids } = storeWith(['alpha beta', 'gamma delta']);
    const cache = new DisplayBridgeCache();
    bridge(store.currentModel, cache);
    // Nothing edited, but we claim one block is dirty: it must rebuild anyway.
    bridge(store.currentModel, cache, { changed: [ids[0]!] });
    expect(cache.evicted).toBe(1);
    expect(cache.built).toBeGreaterThan(0);
  });

  test('a deleted block is released rather than left to age out', () => {
    const { store, ids, storyId } = storeWith(['alpha beta', 'gamma delta']);
    const cache = new DisplayBridgeCache();
    bridge(store.currentModel, cache);
    store.transact(HUMAN, (c) => c.apply({ op: 'deleteBlock', storyId, blockId: ids[1]! }));
    bridge(store.currentModel, cache, { deleted: [ids[1]!] });
    expect(cache.evicted).toBe(1);
  });

  test('OVER-invalidating is safe: naming every block still matches a cold build', () => {
    const { store, ids } = storeWith(['alpha beta', 'gamma delta', 'epsilon zeta']);
    const cache = new DisplayBridgeCache();
    bridge(store.currentModel, cache);
    const over = bridge(store.currentModel, cache, { changed: ids });
    expect(shape(over)).toBe(shape(bridge(store.currentModel)));
  });

  test('UNDER-invalidating is safe too: fingerprints still catch a real edit', () => {
    // The property that makes eviction-only correct. Edit a block and name NOTHING dirty;
    // the fingerprint must still force the rebuild.
    const { store, ids } = storeWith(['alpha beta', 'gamma delta']);
    const cache = new DisplayBridgeCache();
    bridge(store.currentModel, cache);
    store.transact(HUMAN, (c) =>
      c.apply({ op: 'insertText', paragraphId: ids[0]!, offset: 0, text: 'ZZZ ' }),
    );
    const lying = bridge(store.currentModel, cache, { created: [], changed: [], deleted: [] });
    expect(shape(lying)).toBe(shape(bridge(store.currentModel)));
  });

  test('a MOVE that dirty ids cannot see is still caught, because fingerprints see it', () => {
    // Growing the first paragraph past a wrap pushes the second down. Its id is clean, so a
    // dirty-id-only cache would serve it at the old y. This is why ids cannot replace
    // fingerprints, and the assertion that they do not have to.
    const { store, ids } = storeWith(['short', 'second paragraph here']);
    const cache = new DisplayBridgeCache();
    bridge(store.currentModel, cache);
    store.transact(HUMAN, (c) =>
      c.apply({ op: 'insertText', paragraphId: ids[0]!, offset: 0, text: 'w '.repeat(400) }),
    );
    const moved = bridge(store.currentModel, cache, { changed: [ids[0]!] });
    expect(shape(moved)).toBe(shape(bridge(store.currentModel)));
  });

  test('omitting the invalidation entirely is unchanged behaviour', () => {
    const { store } = storeWith(['alpha beta', 'gamma delta']);
    const cache = new DisplayBridgeCache();
    bridge(store.currentModel, cache);
    expect(shape(bridge(store.currentModel, cache))).toBe(shape(bridge(store.currentModel)));
    expect(cache.evicted).toBe(0);
  });
});

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
import { layoutBody } from '@docx-editor.dev/engine-layout';
import {
  createEmptyModel,
  bodyStoryId,
  DocumentStore,
  ORIGIN_IDS,
  type PackageModel,
  type ParagraphRecord,
} from '@docx-editor.dev/engine-core';
import {
  DisplayBridgeCache,
  toDisplayPages,
  type BridgeInvalidation,
} from '../src/display-bridge.ts';
import { LAYOUT, modelWithTableCell } from './interaction-test-helpers.ts';
import { createHarfBuzzLayoutOptions } from '../../engine-layout/test/fixtures/layout-shaping.ts';

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
  return { store, ids, storyId };
}

const bridge = (
  model: PackageModel,
  cache?: DisplayBridgeCache,
  invalidation?: BridgeInvalidation
) => toDisplayPages(model, layoutBody(model, LAYOUT).pages, { cache, invalidation });

const shape = (r: ReturnType<typeof bridge>) =>
  JSON.stringify({
    items: r.display.map((p) =>
      p.items
        .filter((i) => i.kind === 'text')
        .map((i) => (i.kind === 'text' ? { s: i.semantic, c: i.clusters, b: i.box } : null))
    ),
    nav: r.navigationGeometry.visualLines.map((l) => ({
      id: l.identity,
      edges: l.edges,
      box: l.lineBox,
    })),
    stops: r.semanticIndex.caretStops.length,
  });

describe('bridge consumes dirty block ids', () => {
  test('a font face swap invalidates its dependent while unchanged font dependencies remain reusable', () => {
    const { store, ids } = storeWith(['unchanged paragraph', 'face swap']);
    const options = createHarfBuzzLayoutOptions();
    const cache = new DisplayBridgeCache();
    const publish = () =>
      toDisplayPages(store.currentModel, layoutBody(store.currentModel, options).pages, { cache });
    const before = publish();
    const beforeRuns = before.display
      .flatMap((page) => page.items)
      .flatMap((item) => (item.kind === 'text' ? item.runs : []));

    store.transact(HUMAN, (commands) =>
      commands.apply({
        op: 'setParagraphRuns',
        paragraphId: ids[1]!,
        runs: [{ text: 'face swap', props: { bold: true } }],
      })
    );
    const after = publish();
    const afterRuns = after.display
      .flatMap((page) => page.items)
      .flatMap((item) => (item.kind === 'text' ? item.runs : []));

    expect(beforeRuns[0]!.font.hash).toBe(afterRuns[0]!.font.hash);
    expect(beforeRuns[1]!.font.hash).not.toBe(afterRuns[1]!.font.hash);
    expect(cache.reused).toBeGreaterThan(0);
    expect(cache.built).toBeGreaterThan(0);
  });

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
      c.apply({ op: 'insertText', paragraphId: ids[0]!, offset: 0, text: 'ZZZ ' })
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
      c.apply({ op: 'insertText', paragraphId: ids[0]!, offset: 0, text: 'w '.repeat(400) })
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

// Two defects independent review found in the first version of this feature. Neither had a
// test, and one of them made the feature inert for the chunk that matters most.
describe('eviction reaches every cache and does not retain keys forever', () => {
  test('a deleted paragraph releases its VISUAL LINE set, not only clusters', () => {
    // `linesFor` was called without a blockId, so visual-line keys went untracked and could
    // never be evicted. The line set holds all of that paragraph's caret edges — the bulk of
    // the retained graph — so it was the one thing a delete could not release.
    const { store, ids } = storeWith(['alpha beta gamma', 'delta epsilon zeta']);
    const cache = new DisplayBridgeCache();
    bridge(store.currentModel, cache);
    expect(cache.linesBuilt).toBeGreaterThan(0);

    // Name it deleted WITHOUT changing the model, so the only thing that can drop the line
    // set is the eviction itself — a real delete would remove it from layout anyway, which
    // would pass whether or not the cache released anything.
    const beforeReused = cache.linesReused;
    bridge(store.currentModel, cache, { deleted: [ids[1]!] });
    expect(cache.evicted).toBe(1);
    // Its line set was rebuilt rather than served, which is only possible if the key was
    // tracked and evicted.
    expect(cache.linesBuilt).toBeGreaterThan(0);
    expect(cache.linesReused).toBeLessThan(beforeReused + 2);
    expect(shape(bridge(store.currentModel, cache, {}))).toBe(shape(bridge(store.currentModel)));
  });

  test('the key index is rotated, so eviction still reaches the previous layout', () => {
    // Clearing the index in `rotate()` was the first attempt and broke eviction outright:
    // `rotate()` runs before `invalidateBlocks`, so the keys a dirty id needs are the
    // PREVIOUS layout's. Rotating keeps exactly the two generations the value maps keep.
    const { store, ids } = storeWith(['alpha beta', 'gamma delta']);
    const cache = new DisplayBridgeCache();
    bridge(store.currentModel, cache);
    // Second layout rotates; the ids named here were tracked in the FIRST.
    bridge(store.currentModel, cache, { changed: [ids[0]!] });
    expect(cache.evicted).toBe(1);
  });

  test('naming a block that was never cached does not count as an eviction', () => {
    const { store } = storeWith(['alpha beta']);
    const cache = new DisplayBridgeCache();
    bridge(store.currentModel, cache);
    bridge(store.currentModel, cache, { deleted: ['never-existed'] });
    expect(cache.evicted).toBe(0);
  });
});

// Paragraphs inside containers are reported too.
//
// `paragraphRecordsOf` walked `story.blocks` only, so no paragraph inside a table row, cell
// or SDT was ever reported created/changed/deleted, and on a table-heavy document the dirty
// set was empty and the feature inert. Benign for correctness — ids only evict — but it meant
// prompt release of deleted blocks did not happen for the documents with the most blocks.
describe('dirty ids cover paragraphs inside containers', () => {
  test('a paragraph in a table cell is evictable by id', () => {
    const cache = new DisplayBridgeCache();
    const model = modelWithTableCell('cell text here');
    bridge(model, cache);
    const before = cache.built + cache.linesBuilt;
    expect(before).toBeGreaterThan(0);

    // Name the CELL paragraph dirty. It is only reachable by recursing into rows/cells.
    bridge(model, cache, { changed: ['p-cell'] });
    expect(cache.evicted).toBe(1);
  });
});

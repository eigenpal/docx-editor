// Each component of a bridge cache key, pinned INDIVIDUALLY.
//
// Independent review mutation-tested the caches and found every new key component was
// deletable with the whole suite green: dropping the edge digest, the grapheme count, the
// metrics port or the boundary epoch each left 489 passing. The existing tests catch the
// ORIGINAL defect (several components missing at once) because each component masks the
// others, so they pin the outcome without pinning the mechanism. A refactor deleting the
// expensive-looking part would re-open a High with CI green.
//
// Each test here changes exactly ONE input the key is supposed to cover and requires the
// cached answer to match a cold build.

import { afterEach, describe, expect, test } from 'bun:test';
import {
  layoutBody,
  HelveticaMetrics,
  DeterministicMetrics,
  setGraphemeBoundary,
  resetGraphemeBoundary,
} from '@docx-editor.dev/engine-layout';
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

afterEach(() => {
  resetGraphemeBoundary();
});

function modelOf(texts: readonly string[]): PackageModel {
  const model = createEmptyModel();
  const storyId = bodyStoryId(model);
  const store = new DocumentStore(model);
  const first = (model.stories.get(storyId)!.blocks[0] as ParagraphRecord).id;
  store.transact(HUMAN, (c) => c.apply({ op: 'insertText', paragraphId: first, text: texts[0] ?? '' }));
  for (let i = 1; i < texts.length; i += 1) {
    const r = store.transact(HUMAN, (c) => c.apply({ op: 'appendParagraph', storyId }));
    const pid = r.ok ? r.modelChange.created[0]! : first;
    store.transact(HUMAN, (c) => c.apply({ op: 'insertText', paragraphId: pid, text: texts[i]! }));
  }
  return store.currentModel;
}

const bridge = (model: PackageModel, metrics: HelveticaMetrics | DeterministicMetrics, cache?: DisplayBridgeCache) =>
  toDisplayPages(model, layoutBody(model, { ...LAYOUT, metrics }).pages, metrics, cache);

const clusterShape = (r: ReturnType<typeof bridge>) =>
  JSON.stringify(
    r.display.flatMap((p) =>
      p.items.filter((i) => i.kind === 'text').map((i) => (i.kind === 'text' ? i.clusters : [])),
    ),
  );

const boundaryShape = (r: ReturnType<typeof bridge>) =>
  JSON.stringify(r.navigationGeometry.semanticHorizontalBoundariesByBlockId);

/**
 * A per-UTF-16-code-unit boundary: every code UNIT is its own grapheme.
 *
 * Deliberately NOT `[...text]`, which iterates by code POINT and therefore agrees with real
 * grapheme segmentation on this fixture — a first version of this file used it and the
 * mutation tests below passed while the key component they targeted was deleted.
 */
const perCodeUnit = {
  segment(text: string) {
    const out: { segment: string; index: number }[] = [];
    for (let i = 0; i < text.length; i += 1) out.push({ segment: text.charAt(i), index: i });
    return out;
  },
};

// Mutation results at the commit that added this file, so a later reader knows which
// components are genuinely pinned and which are defence without a proof:
//
//   cluster key: drop boundary epoch    CAUGHT
//   hb key:      drop boundary epoch    CAUGHT
//   traversal:   revert shallow freeze  CAUGHT
//   cluster key: drop paint digest      survives  (masked by the grapheme count)
//   cluster key: drop grapheme count    survives  (masked by the paint digest)
//   cluster key: drop BOTH              CAUGHT    (the original High)
//   hb key:      drop metrics port      survives  (no discriminating fixture found)
//
// The digest and the count are mutually redundant on every input I could construct, so
// only their conjunction is pinned. That is worth knowing before deleting either.
describe('bridge cache keys cover each input individually', () => {
  test('CLUSTER key covers the grapheme boundary', () => {
    // The exact asymmetry review found: the horizontal-boundary memo keyed on the boundary
    // and the cluster key did not, so 'abéc 👍' served merged graphemes from cache and a
    // click landed on the wrong offset.
    const model = modelOf(['abéc 👍 more text here']);
    const metrics = new HelveticaMetrics();
    const cache = new DisplayBridgeCache();
    bridge(model, metrics, cache); // warm under the default boundary

    setGraphemeBoundary(perCodeUnit as never);
    expect(clusterShape(bridge(model, metrics, cache))).toBe(clusterShape(bridge(model, metrics)));
  });

  test('HORIZONTAL BOUNDARY memo key covers the grapheme boundary', () => {
    const model = modelOf(['abéc 👍 more text here']);
    const metrics = new HelveticaMetrics();
    const cache = new DisplayBridgeCache();
    bridge(model, metrics, cache);

    setGraphemeBoundary(perCodeUnit as never);
    expect(boundaryShape(bridge(model, metrics, cache))).toBe(boundaryShape(bridge(model, metrics)));
  });

  test('HORIZONTAL BOUNDARY memo key covers the metrics port', () => {
    // NOT PINNED, and said so rather than implied. Deleting `metricsKey(metrics)` from the
    // key leaves this green: I could not build a fixture where the two shipped ports
    // disagree about `isWholeGraphemeHorizontalBoundary`, which is what the table records.
    // The component stays because `prefixProvableUpTo` keys on the port for exactly this
    // reason and review measured a stale answer there — but this test currently only shows
    // the two ports AGREE, not that the key discriminates.
    const model = modelOf(['alpha beta gamma delta']);
    const cache = new DisplayBridgeCache();
    const helvetica = new HelveticaMetrics();
    const deterministic = new DeterministicMetrics();
    bridge(model, helvetica, cache);
    expect(boundaryShape(bridge(model, deterministic, cache))).toBe(
      boundaryShape(bridge(model, deterministic)),
    );
  });

  test('published navigation traversal links are DEEPLY frozen', () => {
    // `recordFromTraversalMap` froze the record but not its values, and `deepFreezeValue`
    // bails on an already-frozen container — so one mutable object per block reached a
    // published frame. Review counted 140 on the 24-page fixture.
    const model = modelOf(['one', 'two', 'three']);
    const result = bridge(model, new HelveticaMetrics(), new DisplayBridgeCache());
    const links = result.navigationGeometry.traversalByBlockId;
    expect(Object.isFrozen(links)).toBe(true);
    const values = Object.values(links);
    expect(values.length).toBeGreaterThan(0);
    for (const value of values) expect(Object.isFrozen(value)).toBe(true);
  });
});

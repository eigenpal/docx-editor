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
  FontResolutionError,
  createFontResourceSnapshot,
  createDeterministicLayoutShaping,
  harfBuzzFontValidator,
  layoutBody,
  setGraphemeBoundary,
  resetGraphemeBoundary,
  type LayoutShapingOptions,
} from '@docx-editor.dev/engine-layout';
import {
  createEmptyModel,
  bodyStoryId,
  DocumentStore,
  ORIGIN_IDS,
  type PackageModel,
  type ParagraphRecord,
} from '@docx-editor.dev/engine-core';
import { DisplayBridgeCache, toDisplayPages } from '../display-bridge.ts';
import { LAYOUT } from './interaction-test-helpers.ts';
import { createHarfBuzzLayoutOptions } from '../../layout/__tests__/fixtures/layout-shaping.ts';

const HUMAN = ORIGIN_IDS.mutationHuman;

afterEach(() => {
  resetGraphemeBoundary();
});

function modelOf(texts: readonly string[]): PackageModel {
  const model = createEmptyModel();
  const storyId = bodyStoryId(model);
  const store = new DocumentStore(model);
  const first = (model.stories.get(storyId)!.blocks[0] as ParagraphRecord).id;
  store.transact(HUMAN, (c) =>
    c.apply({ op: 'insertText', paragraphId: first, text: texts[0] ?? '' })
  );
  for (let i = 1; i < texts.length; i += 1) {
    const r = store.transact(HUMAN, (c) => c.apply({ op: 'appendParagraph', storyId }));
    const pid = r.ok ? r.modelChange.created[0]! : first;
    store.transact(HUMAN, (c) => c.apply({ op: 'insertText', paragraphId: pid, text: texts[i]! }));
  }
  return store.currentModel;
}

function mixedFaceModel(): PackageModel {
  const model = createEmptyModel();
  const storyId = bodyStoryId(model);
  const store = new DocumentStore(model);
  const first = (model.stories.get(storyId)!.blocks[0] as ParagraphRecord).id;
  store.transact(HUMAN, (commands) =>
    commands.apply({
      op: 'setParagraphRuns',
      paragraphId: first,
      runs: [{ text: 'regular face' }],
    })
  );
  const appended = store.transact(HUMAN, (commands) =>
    commands.apply({ op: 'appendParagraph', storyId })
  );
  const second = appended.ok ? appended.modelChange.created[0]! : first;
  store.transact(HUMAN, (commands) =>
    commands.apply({
      op: 'setParagraphRuns',
      paragraphId: second,
      runs: [{ text: 'bold face', props: { bold: true } }],
    })
  );
  return store.currentModel;
}

function harfBuzzShapingAtEpoch(
  epoch: number,
  options: { changeRegularBytes?: boolean } = {}
): LayoutShapingOptions {
  const base = createHarfBuzzLayoutOptions().shaping;
  const regularRequest = { family: 'DejaVu Sans', weight: 400, style: 'normal' as const };
  const boldRequest = { family: 'DejaVu Sans', weight: 700, style: 'normal' as const };
  const regular = base.fonts.resolve(regularRequest);
  const bold = base.fonts.resolve(boldRequest);
  if (regular instanceof FontResolutionError || bold instanceof FontResolutionError) {
    throw new Error('expected fixture fonts');
  }
  const regularSource = options.changeRegularBytes ? bold : regular;
  const fonts = createFontResourceSnapshot({
    epoch,
    maxFontBytes: 2_000_000,
    resources: [
      {
        request: regularRequest,
        id: options.changeRegularBytes ? 'dejavu-sans-regular-changed' : regular.id,
        bytes: regularSource.bytes,
        hash: regularSource.hash,
        faceIndex: regularSource.faceIndex,
      },
      {
        request: boldRequest,
        id: bold.id,
        bytes: bold.bytes,
        hash: bold.hash,
        faceIndex: bold.faceIndex,
      },
    ],
    validateFont: harfBuzzFontValidator,
  });
  return {
    ...base,
    fonts,
    operation: { ...base.operation, resourceEpoch: epoch },
  };
}

const bridge = (model: PackageModel, shaping: LayoutShapingOptions, cache?: DisplayBridgeCache) =>
  toDisplayPages(model, layoutBody(model, { ...LAYOUT, shaping }).pages, { cache });

const clusterShape = (r: ReturnType<typeof bridge>) =>
  JSON.stringify(
    r.display.flatMap((p) =>
      p.items.filter((i) => i.kind === 'text').map((i) => (i.kind === 'text' ? i.clusters : []))
    )
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
    const out: { index: number; text: string; utf16From: number; utf16To: number }[] = [];
    for (let i = 0; i < text.length; i += 1) {
      out.push({ index: i, text: text.charAt(i), utf16From: i, utf16To: i + 1 });
    }
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
//   hb key:      drop metrics port      survives HERE, but IS pinnable — see note below
//
// The digest and the count are mutually redundant on every input I could construct, so
// only their conjunction is pinned. That is worth knowing before deleting either.
describe('bridge cache keys cover each input individually', () => {
  test('CLUSTER key covers the grapheme boundary', () => {
    // The exact asymmetry review found: the horizontal-boundary memo keyed on the boundary
    // and the cluster key did not, so 'abéc 👍' served merged graphemes from cache and a
    // click landed on the wrong offset.
    const model = modelOf(['abéc 👍 more text here']);
    const shaping = createDeterministicLayoutShaping();
    const cache = new DisplayBridgeCache();
    bridge(model, shaping, cache); // warm under the default boundary

    setGraphemeBoundary(perCodeUnit as never);
    expect(clusterShape(bridge(model, shaping, cache))).toBe(clusterShape(bridge(model, shaping)));
  });

  test('HORIZONTAL BOUNDARY memo key covers the grapheme boundary', () => {
    const model = modelOf(['abéc 👍 more text here']);
    const shaping = createDeterministicLayoutShaping();
    const cache = new DisplayBridgeCache();
    bridge(model, shaping, cache);

    setGraphemeBoundary(perCodeUnit as never);
    expect(boundaryShape(bridge(model, shaping, cache))).toBe(
      boundaryShape(bridge(model, shaping))
    );
  });

  test('HORIZONTAL BOUNDARY memo key covers shaped cluster changes', () => {
    const model = modelOf(['fi']);
    const cache = new DisplayBridgeCache();
    const deterministic = createDeterministicLayoutShaping();
    const harfBuzz = createHarfBuzzLayoutOptions().shaping;
    bridge(model, deterministic, cache);
    expect(boundaryShape(bridge(model, harfBuzz, cache))).toBe(
      boundaryShape(bridge(model, harfBuzz))
    );
  });

  test('CLUSTER key covers the complete shaping environment when geometry is unchanged', () => {
    const model = modelOf(['iiii']);
    const options = createHarfBuzzLayoutOptions();
    const changed: LayoutShapingOptions = {
      ...options.shaping,
      environment: {
        ...options.shaping.environment,
        features: { ...options.shaping.environment.features, kern: 0 },
      },
    };
    const coldBefore = bridge(model, options.shaping);
    const coldAfter = bridge(model, changed);
    const boxes = (result: ReturnType<typeof bridge>) =>
      result.display.flatMap((page) =>
        page.items
          .filter((item) => item.kind === 'text')
          .map((item) => (item.kind === 'text' ? item.box : null))
      );
    expect(boxes(coldAfter)).toEqual(boxes(coldBefore));

    const cache = new DisplayBridgeCache();
    bridge(model, options.shaping, cache);
    bridge(model, changed, cache);
    expect(cache.built).toBeGreaterThan(0);
    expect(clusterShape(bridge(model, changed, cache))).toBe(clusterShape(coldAfter));
  });

  test('resource epoch restart reuses identical fonts and rebuilds only changed font dependents', () => {
    const model = mixedFaceModel();
    const cache = new DisplayBridgeCache();
    const initial = harfBuzzShapingAtEpoch(1);
    const identicalRestart = harfBuzzShapingAtEpoch(2);
    const changedRegular = harfBuzzShapingAtEpoch(3, { changeRegularBytes: true });

    bridge(model, initial, cache);
    bridge(model, identicalRestart, cache);
    expect(cache.built).toBe(0);
    expect(cache.reused).toBe(2);

    bridge(model, changedRegular, cache);
    expect(cache.built).toBe(1);
    expect(cache.reused).toBe(1);
  });

  test('published navigation traversal links are DEEPLY frozen', () => {
    // `recordFromTraversalMap` froze the record but not its values, and `deepFreezeValue`
    // bails on an already-frozen container — so one mutable object per block reached a
    // published frame. Review counted 140 on the 24-page fixture.
    const model = modelOf(['one', 'two', 'three']);
    const result = bridge(model, createDeterministicLayoutShaping(), new DisplayBridgeCache());
    const links = result.navigationGeometry.traversalByBlockId;
    expect(Object.isFrozen(links)).toBe(true);
    const values = Object.values(links);
    expect(values.length).toBeGreaterThan(0);
    for (const value of values) expect(Object.isFrozen(value)).toBe(true);
  });
});

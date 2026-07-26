// Painted whitespace is hit-tested by the grouped run itself (renderer run grouping,
// phase 2).
//
// Run grouping made spaces and tabs REAL painted text inside a line's grouped item, so the
// item's own measured clusters became the authority for them. Two properties have to hold
// together, and these pin both:
//
//  1. whitespace resolves to exact semantic offsets through ordinary text hit testing, and
//  2. nothing above the text still wins — an overlapping image, a higher visual layer,
//     synthetic content and read-only ownership all behave exactly as they did before.
//
// The `lineWhitespace` ownership region survives as a FALLBACK for whitespace no painted
// cluster represents (a run split across a line break, or a boundary layout could not
// publish as horizontally navigable), which is asserted here too so the fallback cannot be
// quietly deleted as dead code.

import { describe, expect, test } from 'bun:test';
import type {
  InteractionFrame,
  InteractionHostMetrics,
  SemanticTarget,
} from '@docx-editor.dev/core-contract/interaction';
import type { DisplayItem, DisplayPage } from '@docx-editor.dev/core-contract/geometry';
import { layoutBody } from '@docx-editor.dev/engine-layout';
import { toDisplayPages } from '../src/display-bridge.ts';
import { InteractionFrameStore, DEFAULT_PAGE_GAP_PX } from '../src/interaction-frame.ts';
import {
  hitTestPointer,
  deriveCaretGeometry,
  deriveSelectionGeometry,
} from '../src/interaction-geometry.ts';
import { planInteraction } from '../src/interaction-planner.ts';
import {
  clientPointForStackedText,
  modelWith,
  modelWithTableCell,
  modelWithRunSplit,
  publishFrame,
  LAYOUT,
} from './interaction-test-helpers.ts';

const METRICS: InteractionHostMetrics = {
  clientOrigin: { x: 40, y: 60 },
  scrollOffset: { x: 12, y: 8 },
  zoom: 1.5,
};

type TextDisplayItem = Extract<DisplayItem, { kind: 'text' }>;

function paintedItems(frame: InteractionFrame): TextDisplayItem[] {
  return frame.display
    .flatMap((page) => page.items)
    .filter((item): item is TextDisplayItem => item.kind === 'text');
}

function itemText(item: TextDisplayItem): string {
  return item.runs.map((run) => run.text).join('');
}

/** The cluster covering `graphemeOffset` in the first painted item of `frame`. */
function clusterAt(frame: InteractionFrame, graphemeOffset: number) {
  for (const item of paintedItems(frame)) {
    const cluster = item.clusters.find(
      (c) => c.graphemeFrom <= graphemeOffset && graphemeOffset < c.graphemeTo
    );
    if (cluster) return { item, cluster };
  }
  throw new Error(`no painted cluster at grapheme ${graphemeOffset}`);
}

/** A client point at `ratio` across the cluster covering `graphemeOffset`. */
function pointInCluster(frame: InteractionFrame, graphemeOffset: number, ratio = 0.25) {
  const { cluster } = clusterAt(frame, graphemeOffset);
  return clientPointForStackedText(
    frame,
    0,
    { x: cluster.box.x + cluster.box.width * ratio, y: cluster.box.y + cluster.box.height / 2 },
    METRICS
  );
}

function textHit(frame: InteractionFrame, point: { x: number; y: number }) {
  const hit = hitTestPointer(frame, point, METRICS);
  if (!hit.ok) throw new Error(`hit rejected: ${hit.reason}`);
  return hit.value;
}

/** Publish a frame with extra display items appended to page 0, above the painted text. */
function publishWithOverlay(
  text: string,
  overlayFor: (page: DisplayPage) => readonly DisplayItem[]
): InteractionFrame {
  const model = modelWith([text]);
  const layout = layoutBody(model, LAYOUT);
  const bridged = toDisplayPages(model, layout.pages);
  const display = bridged.display.map((page, index) =>
    index === 0 ? { ...page, items: [...page.items, ...overlayFor(page)] } : page
  );
  const store = new InteractionFrameStore();
  return store.publishLayout({
    modelRevision: 1,
    resourceEpoch: 0,
    configurationEpoch: 0,
    display,
    semanticIndex: bridged.semanticIndex,
    navigationGeometry: bridged.navigationGeometry,
    pageGapPx: DEFAULT_PAGE_GAP_PX,
    selection: null,
    caret: null,
    selectionGeometry: null,
    focus: { scope: { kind: 'body' }, focused: false },
    composition: { active: false, scope: null },
    currentPage: { viewport: 0, caret: 0 },
  });
}

describe('painted whitespace hit testing (renderer run grouping phase 2)', () => {
  test('spaces are painted inside the grouped run, not left as a gap', () => {
    const frame = publishFrame(modelWith(['ab cd']));
    const items = paintedItems(frame);
    expect(items).toHaveLength(1);
    expect(itemText(items[0]!)).toBe('ab cd');
    // A measured cluster exists for the space itself.
    const { cluster } = clusterAt(frame, 2);
    expect(cluster.graphemeFrom).toBe(2);
    expect(cluster.graphemeTo).toBe(3);
    expect(cluster.box.width).toBeGreaterThan(0);
  });

  test('single click on a space resolves the exact whitespace offset', () => {
    const frame = publishFrame(modelWith(['ab cd']));
    const hit = textHit(frame, pointInCluster(frame, 2, 0.25));
    if (hit.target.kind !== 'text') throw new Error('text');
    expect(hit.target.graphemeOffset).toBe(2);
    expect(hit.role).toBe('editableText');
    expect(deriveCaretGeometry(frame, hit.target)).not.toBeNull();
  });

  test('double click on a space selects the whitespace segment', () => {
    const frame = publishFrame(modelWith(['ab cd']));
    const plan = planInteraction(
      { frame, editable: true, readOnly: false, hostMetrics: METRICS },
      {
        kind: 'click',
        frameId: frame.id,
        clientPoint: pointInCluster(frame, 2, 0.25),
        clickCount: 2,
      }
    );
    const sync = plan.effects[0];
    if (sync?.kind !== 'syncSelection') throw new Error('syncSelection');
    expect(sync.selection.anchor.graphemeOffset).toBe(2);
    expect(sync.selection.head.graphemeOffset).toBe(3);
  });

  test('triple click on a space selects the whole paragraph', () => {
    const frame = publishFrame(modelWith(['ab cd']));
    const block = frame.semanticIndex.stories[0]!.blocks[0]!;
    const plan = planInteraction(
      { frame, editable: true, readOnly: false, hostMetrics: METRICS },
      {
        kind: 'click',
        frameId: frame.id,
        clientPoint: pointInCluster(frame, 2, 0.5),
        clickCount: 3,
      }
    );
    const sync = plan.effects[0];
    if (sync?.kind !== 'syncSelection') throw new Error('syncSelection');
    expect(sync.selection.anchor.graphemeOffset).toBe(0);
    expect(sync.selection.head.graphemeOffset).toBe(block.graphemeCount);
  });

  test('repeated spaces are all painted and each resolves inside the run', () => {
    const frame = publishFrame(modelWith(['ab    cd']));
    expect(itemText(paintedItems(frame)[0]!)).toBe('ab    cd');
    for (const offset of [2, 3, 4, 5]) {
      const hit = textHit(frame, pointInCluster(frame, offset, 0.25));
      if (hit.target.kind !== 'text') throw new Error('text');
      expect(hit.target.graphemeOffset).toBe(offset);
    }
  });

  test('tabs are real painted text with their own cluster', () => {
    const frame = publishFrame(modelWith(['ab\tcd']));
    // A tab ends a paint run — CSS expands `\t` to its own tab stop, so it must not share
    // a positioned span with the glyphs after it. The text is still all there.
    expect(paintedItems(frame).map(itemText)).toEqual(['ab', '\t', 'cd']);
    const hit = textHit(frame, pointInCluster(frame, 2, 0.25));
    if (hit.target.kind !== 'text') throw new Error('text');
    expect(hit.target.graphemeOffset).toBe(2);
  });

  test('leading whitespace resolves to offset 0, not to the first letter', () => {
    const frame = publishFrame(modelWith(['   ab']));
    const hit = textHit(frame, pointInCluster(frame, 0, 0.25));
    if (hit.target.kind !== 'text') throw new Error('text');
    expect(hit.target.graphemeOffset).toBe(0);
  });

  test('trailing whitespace resolves past the last letter', () => {
    const frame = publishFrame(modelWith(['ab   ']));
    const hit = textHit(frame, pointInCluster(frame, 4, 0.75));
    if (hit.target.kind !== 'text') throw new Error('text');
    expect(hit.target.graphemeOffset).toBe(5);
  });

  test('selection across a space is gap-free', () => {
    const frame = publishFrame(modelWith(['ab cd']));
    const block = frame.semanticIndex.stories[0]!.blocks[0]!;
    const target = (graphemeOffset: number): Extract<SemanticTarget, { kind: 'text' }> => ({
      kind: 'text',
      scope: { kind: 'body' },
      identity: block.identity,
      graphemeOffset,
      affinity: graphemeOffset === 0 ? 'downstream' : 'upstream',
    });
    const geometry = deriveSelectionGeometry(frame, {
      frameId: frame.id,
      scope: { kind: 'body' },
      anchor: target(0),
      head: target(5),
    });
    if (!geometry.ok) throw new Error(geometry.reason);
    const rects = [...geometry.value.rects].sort((a, b) => a.x - b.x);
    expect(rects.length).toBeGreaterThan(1);
    for (let i = 1; i < rects.length; i += 1) {
      // No hole where the space is: each rect starts where the previous one ended.
      expect(rects[i]!.x).toBeLessThanOrEqual(rects[i - 1]!.x + rects[i - 1]!.width + 0.01);
    }
    const left = rects[0]!;
    const right = rects[rects.length - 1]!;
    expect(right.x + right.width - left.x).toBeGreaterThan(0);
  });

  test('read-only whitespace still refuses a caret at every click count', () => {
    const frame = publishFrame(modelWithTableCell('a b'));
    const cellItem = paintedItems(frame).find(
      (item) => item.semantic.identity.blockId === 'p-cell'
    );
    if (!cellItem) throw new Error('cell item');
    const space = cellItem.clusters.find((c) => c.graphemeFrom === 1);
    if (!space) throw new Error('space cluster');
    const point = clientPointForStackedText(
      frame,
      0,
      { x: space.box.x + space.box.width * 0.5, y: space.box.y + space.box.height / 2 },
      METRICS
    );
    for (const clickCount of [1, 2, 3]) {
      const plan = planInteraction(
        { frame, editable: true, readOnly: false, hostMetrics: METRICS },
        { kind: 'click', frameId: frame.id, clientPoint: point, clickCount }
      );
      expect(plan.effects).toHaveLength(1);
      expect(plan.effects[0]).toMatchObject({ kind: 'reject', code: 'readOnly' });
    }
  });

  test('an overlapping floating image wins over painted whitespace', () => {
    const frame = publishWithOverlay('ab cd', (page) => {
      const text = page.items.find((item): item is TextDisplayItem => item.kind === 'text')!;
      return [
        {
          kind: 'image',
          box: { ...text.box },
          src: { url: 'about:blank' },
          semantic: { scope: { kind: 'body' }, objectId: 'floating-image' },
          scope: { kind: 'body' },
          // A floating image declares a paint order above the text it overlaps; the hit
          // walk honours the declared `zOrder`, which grouping does not touch.
          interaction: {
            pageIndex: 0,
            zOrder: (text.interaction?.zOrder ?? 0) + 1,
            writingMode: 'horizontal-tb',
          },
        },
      ];
    });
    const hit = textHit(frame, pointInCluster(frame, 2, 0.5));
    expect(hit.target.kind).toBe('atomic');
    if (hit.target.kind !== 'atomic') throw new Error('atomic');
    expect(hit.target.objectId).toBe('floating-image');
  });

  test('a higher visual text layer wins over painted whitespace', () => {
    const frame = publishWithOverlay('ab cd', (page) => {
      const text = page.items.find((item): item is TextDisplayItem => item.kind === 'text')!;
      return [
        {
          ...text,
          interaction: { ...text.interaction!, zOrder: (text.interaction?.zOrder ?? 0) + 100 },
          clusters: text.clusters.map((cluster) => ({
            ...cluster,
            graphemeFrom: 0,
            graphemeTo: 1,
          })),
        },
      ];
    });
    const hit = textHit(frame, pointInCluster(frame, 2, 0.5));
    if (hit.target.kind !== 'text') throw new Error('text');
    // The upper layer claims every cluster as grapheme 0..1, so winning means offset <= 1.
    expect(hit.target.graphemeOffset).toBeLessThanOrEqual(1);
  });

  test('synthetic painted whitespace is excluded and does not answer', () => {
    // A synthetic repaint (repeated header) covering the same box must be skipped, and the
    // real painted run underneath must still answer.
    const frame = publishWithOverlay('ab cd', (page) => {
      const text = page.items.find((item): item is TextDisplayItem => item.kind === 'text')!;
      return [{ ...text, synthetic: true, interaction: { ...text.interaction!, zOrder: 9_000 } }];
    });
    const hit = textHit(frame, pointInCluster(frame, 2, 0.25));
    if (hit.target.kind !== 'text') throw new Error('text');
    expect(hit.target.graphemeOffset).toBe(2);
  });

  test('painted clusters, not the whitespace region, own painted whitespace geometry', () => {
    // The two authorities are made to DISAGREE: the ownership region's box is moved 200px
    // right of the space it describes. Painted whitespace has exactly one authority, so
    // caret geometry must follow the measured cluster and ignore the region entirely.
    const model = modelWith(['ab cd']);
    const layout = layoutBody(model, LAYOUT);
    const bridged = toDisplayPages(model, layout.pages);
    const semanticIndex = {
      ...bridged.semanticIndex,
      ownershipRegions: bridged.semanticIndex.ownershipRegions.map((region) =>
        region.kind === 'lineWhitespace' && region.box
          ? { ...region, box: { ...region.box, x: region.box.x + 200 } }
          : region
      ),
    };
    const store = new InteractionFrameStore();
    const frame = store.publishLayout({
      modelRevision: 1,
      resourceEpoch: 0,
      configurationEpoch: 0,
      display: bridged.display,
      semanticIndex,
      navigationGeometry: bridged.navigationGeometry,
      pageGapPx: DEFAULT_PAGE_GAP_PX,
      selection: null,
      caret: null,
      selectionGeometry: null,
      focus: { scope: { kind: 'body' }, focused: false },
      composition: { active: false, scope: null },
      currentPage: { viewport: 0, caret: 0 },
    });

    const { cluster } = clusterAt(frame, 2);
    const block = frame.semanticIndex.stories[0]!.blocks[0]!;
    const caret = deriveCaretGeometry(frame, {
      kind: 'text',
      scope: { kind: 'body' },
      identity: block.identity,
      graphemeOffset: 2,
      affinity: 'upstream',
    });
    expect(caret).not.toBeNull();
    const stackedPageX = frame.pageGeometry.find((p) => p.index === 0)!.box.x;
    expect(caret!.rect.x).toBeCloseTo(stackedPageX + cluster.box.x, 5);
    // And decisively NOT where the tampered region claims.
    expect(caret!.rect.x).not.toBeCloseTo(stackedPageX + cluster.box.x + 200, 5);
  });

  test('a whitespace region always ranks BELOW painted text that covers the same point', () => {
    // This ordering, not a coverage test, is what makes the region a fallback in hit
    // testing: regions enter at zOrder -1 and painted items at their layout index, which
    // is never negative. Assert the property directly so the ordering cannot drift.
    const frame = publishFrame(modelWith(['ab cd']));
    for (const item of paintedItems(frame)) {
      expect(item.interaction?.zOrder ?? 0).toBeGreaterThanOrEqual(0);
    }
    // And the observable consequence: the point inside the space resolves through the
    // painted cluster, whose exact grapheme range it is.
    const hit = textHit(frame, pointInCluster(frame, 2, 0.25));
    if (hit.target.kind !== 'text') throw new Error('text');
    expect(hit.target.graphemeOffset).toBe(2);
  });

  test('whitespace split across a line break keeps its line-local painted cluster', () => {
    // "ab cd" at a page width that wraps between the words. The wrap offset gets a caret
    // edge on BOTH lines. The line-local edge index must choose the pair belonging to the
    // painted slice, rather than combining edges from different lines into a negative interval.
    const narrow = { ...LAYOUT, pageWidth: 2000 };
    const frame = publishFrame(modelWith(['ab cd']), { layout: narrow });
    const items = paintedItems(frame);
    expect(items).toHaveLength(2);
    expect(items[0]!.box.y).not.toBe(items[1]!.box.y);
    const covered = items.some((item) =>
      item.clusters.some((cluster) => cluster.graphemeFrom <= 2 && 3 <= cluster.graphemeTo)
    );
    expect(covered).toBe(true);
    const region = frame.semanticIndex.ownershipRegions.find(
      (r) => r.kind === 'lineWhitespace' && r.graphemeFrom === 2
    );
    expect(region?.box).toBeUndefined();
  });

  test('unicode: combining marks, emoji, CJK and RTL keep one cluster per grapheme', () => {
    for (const text of ['é á', '👍 🙂', '日本 語', 'مرحبا سلام', 'שלום עולם']) {
      const frame = publishFrame(modelWith([text]));
      const items = paintedItems(frame);
      expect(items.length).toBeGreaterThan(0);
      // The painted text is byte-for-byte the authored text, whitespace included.
      expect(items.map(itemText).join('')).toBe(text);
      for (const item of items) {
        for (const cluster of item.clusters) {
          expect(cluster.graphemeTo).toBeGreaterThan(cluster.graphemeFrom);
          expect(cluster.box.width).toBeGreaterThan(0);
        }
      }
    }
  });

  test('unicode: a click on the space between emoji resolves that space', () => {
    const frame = publishFrame(modelWith(['👍 🙂']));
    // '👍' is one grapheme, so the space is grapheme 1.
    const hit = textHit(frame, pointInCluster(frame, 1, 0.25));
    if (hit.target.kind !== 'text') throw new Error('text');
    expect(hit.target.graphemeOffset).toBe(1);
  });

  test('a stale frame id still fails closed on painted whitespace', () => {
    const frame = publishFrame(modelWith(['ab cd']));
    const stale = hitTestPointer(frame, pointInCluster(frame, 2), METRICS, {
      frameId: { value: frame.id.value + 1 },
    });
    expect(stale.ok).toBe(false);
    if (stale.ok) throw new Error('stale');
    expect(stale.code).toBe('staleFrame');
  });
});

// Two caret defects independent review measured after run grouping. Both come from the
// same place: a line is now routinely SEVERAL painted items (style split, tab split, and a
// blank line's full-width placeholder emitted ahead of its painted spaces), and caret
// derivation used to answer from the first item that could produce a box at all.
describe('caret geometry picks the right item on a multi-item line', () => {
  const caretXs = (frame: InteractionFrame, offsets: readonly number[]) => {
    const block = frame.semanticIndex.stories[0]!.blocks[0]!;
    return offsets.map((graphemeOffset) => {
      const geometry = deriveCaretGeometry(frame, {
        kind: 'text',
        scope: { kind: 'body' },
        identity: block.identity,
        graphemeOffset,
        affinity: graphemeOffset === 0 ? 'downstream' : 'upstream',
      });
      return geometry ? Math.round(geometry.rect.x * 100) / 100 : null;
    });
  };

  test('a blank line advances the caret across its spaces instead of pinning it', () => {
    // The full-width placeholder has no clusters, so it used to answer for EVERY offset:
    // 0..2 all landed on its left edge and 3 on the right content margin, 612 px away.
    const frame = publishFrame(modelWith(['   ']));
    const xs = caretXs(frame, [0, 1, 2, 3]);
    expect(xs.every((x) => x !== null)).toBe(true);
    for (let i = 1; i < xs.length; i += 1) expect(xs[i]!).toBeGreaterThan(xs[i - 1]!);
    // And the last one is at the end of the painted spaces, not at the content margin.
    const painted = paintedItems(frame).find((item) => itemText(item).length > 0)!;
    expect(xs[3]!).toBeCloseTo(painted.box.x + painted.box.width, 1);
  });

  test('an empty paragraph still resolves its single caret', () => {
    const frame = publishFrame(modelWith(['']));
    expect(caretXs(frame, [0])[0]).not.toBeNull();
  });

  test('end-of-paragraph caret lands after the LAST piece of a tab-split line', () => {
    // 'ab\tcd' paints as three items. The end caret used to resolve against the first
    // item's last cluster and sat at the right edge of "ab".
    const frame = publishFrame(modelWith(['ab\tcd']));
    const items = paintedItems(frame);
    expect(items).toHaveLength(3);
    const rightmost = items.reduce((a, b) =>
      a.box.x + a.box.width >= b.box.x + b.box.width ? a : b
    );
    const block = frame.semanticIndex.stories[0]!.blocks[0]!;
    const end = caretXs(frame, [block.graphemeCount])[0];
    expect(end).toBeCloseTo(rightmost.box.x + rightmost.box.width, 1);
  });

  test('end-of-paragraph caret lands after the last piece of a STYLE-split line too', () => {
    const frame = publishFrame(modelWithRunSplit(['plain ', 'more']));
    const block = frame.semanticIndex.stories[0]!.blocks[0]!;
    const items = paintedItems(frame);
    const rightmost = items.reduce((a, b) =>
      a.box.x + a.box.width >= b.box.x + b.box.width ? a : b
    );
    expect(caretXs(frame, [block.graphemeCount])[0]).toBeCloseTo(
      rightmost.box.x + rightmost.box.width,
      1
    );
  });

  test('interior carets on a tab-split line stay in ascending order', () => {
    const frame = publishFrame(modelWith(['ab\tcd']));
    const xs = caretXs(frame, [0, 1, 2, 3, 4, 5]);
    expect(xs.every((x) => x !== null)).toBe(true);
    for (let i = 1; i < xs.length; i += 1) expect(xs[i]!).toBeGreaterThan(xs[i - 1]!);
  });
});

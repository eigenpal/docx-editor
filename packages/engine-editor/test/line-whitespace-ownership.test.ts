// Precise lineWhitespace ownership (interactive-paginated-editing 3.x / task 5.3).

import { describe, expect, test } from 'bun:test';
import type { InteractionFrame, InteractionHostMetrics } from '@docx-editor.dev/core-contract/interaction';
import { toDisplayPages } from '../src/display-bridge.ts';
import { caretOverlayForTarget } from '../src/interaction-geometry.ts';
import { freezeNavigationGeometry } from '../src/navigation-geometry.ts';
import { InteractionFrameStore } from '../src/interaction-frame.ts';
import { contentToClient, IDENTITY_HOST_METRICS } from '../src/coordinate-mapper.ts';
import { deriveCaretGeometry, hitTestPointer } from '../src/interaction-geometry.ts';
import { deepFreezeValue } from '../src/interaction-frame.ts';
import { buildSemanticIndex } from '../src/semantic-index.ts';
import { planInteraction } from '../src/interaction-planner.ts';
import { layoutBody, HelveticaMetrics } from '@docx-editor.dev/engine-layout';
import {
  clientPointForStackedText,
  modelWith,
  modelWithTableCell,
  publishFrame,
  LAYOUT,
} from './interaction-test-helpers.ts';

const METRICS: InteractionHostMetrics = {
  clientOrigin: { x: 40, y: 60 },
  scrollOffset: { x: 12, y: 8 },
  zoom: 1.5,
};

function frameFor(text: string): InteractionFrame {
  return publishFrame(modelWith([text]));
}

function whitespaceRegion(frame: InteractionFrame, blockId?: string) {
  const id = blockId ?? frame.semanticIndex.stories[0]!.blocks[0]!.identity.blockId;
  return frame.semanticIndex.ownershipRegions.find(
    (r) => r.kind === 'lineWhitespace' && r.identity.blockId === id && r.box,
  );
}

function pointInWhitespaceBox(
  frame: InteractionFrame,
  region: NonNullable<ReturnType<typeof whitespaceRegion>>,
  xRatio = 0.25,
) {
  const box = region.box!;
  return clientPointForStackedText(
    frame,
    region.pageIndex ?? 0,
    { x: box.x + box.width * xRatio, y: box.y + box.height * 0.5 },
    METRICS,
  );
}

function paragraphUnionBox(frame: InteractionFrame, blockId: string) {
  const items = frame.display.flatMap((p) => p.items).filter((i) => i.kind === 'text' && i.semantic.identity.blockId === blockId);
  if (items.length === 0) return null;
  const first = items[0]!.box;
  return items.reduce(
    (acc, item) => ({
      x: Math.min(acc.x, item.box.x),
      y: Math.min(acc.y, item.box.y),
      width: Math.max(acc.x + acc.width, item.box.x + item.box.width) - Math.min(acc.x, item.box.x),
      height: Math.max(acc.y + acc.height, item.box.y + item.box.height) - Math.min(acc.y, item.box.y),
    }),
    first,
  );
}

describe('lineWhitespace ownership (task 5.3 defect)', () => {
  test('semantic index emits grapheme ranges for lineWhitespace subranges', () => {
    const index = buildSemanticIndex(modelWith(['ab cd']));
    const ws = index.ownershipRegions.find((r) => r.kind === 'lineWhitespace');
    expect(ws).toMatchObject({ utf16From: 2, utf16To: 3, graphemeFrom: 2, graphemeTo: 3 });
  });

  test('display bridge derives precise inline gap box for ab cd, not paragraph union', () => {
    const model = modelWith(['ab cd']);
    const layout = layoutBody(model, LAYOUT);
    const { semanticIndex } = toDisplayPages(model, layout.pages);
    const blockId = semanticIndex.stories[0]!.blocks[0]!.identity.blockId;
    const ws = semanticIndex.ownershipRegions.find((r) => r.kind === 'lineWhitespace' && r.identity.blockId === blockId);
    expect(ws?.box).toBeDefined();
    const union = paragraphUnionBox({ display: toDisplayPages(model, layout.pages).display } as InteractionFrame, blockId);
    expect(ws!.box!.width).toBeLessThan(union!.width);
    expect(ws!.box!.width).toBeGreaterThan(0);
    expect(ws).toMatchObject({ graphemeFrom: 2, graphemeTo: 3 });
  });

  test('hitTestPointer on inline whitespace resolves grapheme 2 at the gap, not paragraph start', () => {
    const frame = frameFor('ab cd');
    const ws = whitespaceRegion(frame)!;
    const box = ws.box!;
    const hit = hitTestPointer(
      frame,
      clientPointForStackedText(frame, ws.pageIndex ?? 0, { x: box.x + box.width * 0.25, y: box.y + box.height / 2 }, METRICS),
      METRICS,
    );
    expect(hit.ok).toBe(true);
    if (!hit.ok || hit.value.target.kind !== 'text') throw new Error('hit');
    expect(hit.value.target.graphemeOffset).toBe(2);
    expect(hit.value.role).toBe('editableText');
  });

  test('double-click on inline whitespace selects exactly grapheme 2..3 via planInteraction', () => {
    const frame = frameFor('ab cd');
    const ws = whitespaceRegion(frame)!;
    const plan = planInteraction(
      { frame, editable: true, readOnly: false, hostMetrics: METRICS },
      { kind: 'click', frameId: frame.id, clientPoint: pointInWhitespaceBox(frame, ws), clickCount: 2 },
    );
    const sync = plan.effects[0];
    expect(sync?.kind).toBe('syncSelection');
    if (sync?.kind !== 'syncSelection') throw new Error('sync');
    expect(sync.selection.anchor.graphemeOffset).toBe(2);
    expect(sync.selection.head.graphemeOffset).toBe(3);
  });

  test('multiple spaces derive one precise gap box between painted slices', () => {
    const frame = frameFor('ab  cd');
    const ws = whitespaceRegion(frame)!;
    expect(ws).toMatchObject({ utf16From: 2, utf16To: 4, graphemeFrom: 2, graphemeTo: 4 });
    expect(ws!.box!.width).toBeGreaterThan(0);
    expect(ws!.box!.width).toBeLessThan(paragraphUnionBox(frame, ws!.identity.blockId)!.width);
    const hit = hitTestPointer(frame, pointInWhitespaceBox(frame, ws), METRICS);
    expect(hit.ok).toBe(true);
    if (!hit.ok || hit.value.target.kind !== 'text') throw new Error('hit');
    expect(hit.value.target.graphemeOffset).toBeGreaterThanOrEqual(2);
    expect(hit.value.target.graphemeOffset).toBeLessThanOrEqual(4);
  });

  test('leading whitespace box sits before first painted slice', () => {
    const frame = frameFor(' ab');
    const ws = whitespaceRegion(frame)!;
    const item = frame.display[0]!.items.find((i) => i.kind === 'text')!;
    expect(ws!.box!.x + ws!.box!.width).toBeLessThanOrEqual(item.box.x + 0.01);
    expect(ws).toMatchObject({ graphemeFrom: 0, graphemeTo: 1 });
  });

  test('trailing inline whitespace box sits after last painted slice', () => {
    const frame = frameFor('ab ');
    const ws = whitespaceRegion(frame)!;
    const item = frame.display[0]!.items.find((i) => i.kind === 'text')!;
    expect(ws!.box!.x).toBeGreaterThanOrEqual(item.box.x + item.box.width - 0.01);
    expect(ws).toMatchObject({ graphemeFrom: 2, graphemeTo: 3 });
  });

  test('painted text wins overlap; whitespace gap remains hittable between slices', () => {
    const frame = frameFor('ab cd');
    const item = frame.display[0]!.items.find((i) => i.kind === 'text' && i.semantic.utf16From === 0)!;
    if (item?.kind !== 'text') throw new Error('text');
    const onLetter = clientPointForStackedText(
      frame,
      0,
      { x: item.clusters[0]!.box.x + 2, y: item.clusters[0]!.box.y + item.clusters[0]!.box.height / 2 },
      METRICS,
    );
    const letterHit = hitTestPointer(frame, onLetter, METRICS);
    expect(letterHit.ok).toBe(true);
    if (!letterHit.ok || letterHit.value.target.kind !== 'text') throw new Error('letter');
    expect(letterHit.value.target.graphemeOffset).toBe(0);

    const ws = whitespaceRegion(frame)!;
    expect(hitTestPointer(frame, pointInWhitespaceBox(frame, ws), METRICS).ok).toBe(true);
  });

  test('deriveCaretGeometry places carets at both whitespace edges', () => {
    const frame = frameFor('ab cd');
    const ws = whitespaceRegion(frame)!;
    const block = frame.semanticIndex.stories[0]!.blocks[0]!;
    const left = deriveCaretGeometry(frame, {
      kind: 'text',
      scope: { kind: 'body' },
      identity: block.identity,
      graphemeOffset: ws!.graphemeFrom!,
      affinity: 'downstream',
    });
    const right = deriveCaretGeometry(frame, {
      kind: 'text',
      scope: { kind: 'body' },
      identity: block.identity,
      graphemeOffset: ws!.graphemeTo!,
      affinity: 'downstream',
    });
    expect(left).not.toBeNull();
    expect(right).not.toBeNull();
    expect(left!.rect.x).toBeLessThan(right!.rect.x);
  });

  test('zoom and scroll metrics resolve whitespace hits consistently', () => {
    const frame = frameFor('ab cd');
    const ws = whitespaceRegion(frame)!;
    const zoomed = clientPointForStackedText(
      frame,
      ws!.pageIndex ?? 0,
      { x: ws!.box!.x + ws!.box!.width * 0.5, y: ws!.box!.y + ws!.box!.height / 2 },
      METRICS,
    );
    expect(hitTestPointer(frame, zoomed, METRICS).ok).toBe(true);
    const identity = clientPointForStackedText(
      frame,
      ws!.pageIndex ?? 0,
      { x: ws!.box!.x + ws!.box!.width * 0.5, y: ws!.box!.y + ws!.box!.height / 2 },
      IDENTITY_HOST_METRICS,
    );
    expect(hitTestPointer(frame, identity, IDENTITY_HOST_METRICS).ok).toBe(true);
  });

  test('read-only table cell whitespace region is selectableText and rejects editable planner', () => {
    const frame = publishFrame(modelWithTableCell('a b'));
    const ws = whitespaceRegion(frame, 'p-cell');
    expect(ws?.role).toBe('selectableText');
    if (!ws?.box) throw new Error('ws box');
    const plan = planInteraction(
      { frame, editable: true, readOnly: false, hostMetrics: METRICS },
      { kind: 'click', frameId: frame.id, clientPoint: pointInWhitespaceBox(frame, ws), clickCount: 2 },
    );
    expect(plan.effects[0]).toMatchObject({ kind: 'reject', code: 'readOnly' });
  });

  test('lineWhitespace without derivable geometry omits box (fail closed)', () => {
    const index = buildSemanticIndex(modelWith(['x']));
    const ws = index.ownershipRegions.find((r) => r.kind === 'lineWhitespace');
    expect(ws).toBeUndefined();
    const frozen = deepFreezeValue(index);
    expect(Object.isFrozen(frozen.ownershipRegions)).toBe(true);
  });

  test('deep-frozen ownership regions reject mutation', () => {
    const frame = frameFor('ab cd');
    expect(Object.isFrozen(frame.semanticIndex.ownershipRegions)).toBe(true);
    const ws = whitespaceRegion(frame)!;
    expect(ws!.graphemeFrom).toBe(2);
    expect(() => {
      (frame.semanticIndex.ownershipRegions[0] as { kind: string }).kind = 'mutated';
    }).toThrow();
  });

  test('multiline adjacent slices fail closed without inventing whitespace box or hit', () => {
    const model = modelWith(['ab cd']);
    const layout = layoutBody(model, { ...LAYOUT, pageWidth: 2000 });
    const { semanticIndex, display } = toDisplayPages(model, layout.pages);
    const ws = semanticIndex.ownershipRegions.find((r) => r.kind === 'lineWhitespace');
    expect(ws).toMatchObject({ utf16From: 2, utf16To: 3, graphemeFrom: 2, graphemeTo: 3 });
    expect(ws!.box).toBeUndefined();
    const slices = display[0]!.items.filter((i) => i.kind === 'text');
    expect(slices).toHaveLength(2);
    expect(slices[0]!.box.y).not.toBe(slices[1]!.box.y);

    const frame = publishFrame(model, { layout: { ...LAYOUT, pageWidth: 2000 } });
    expect(whitespaceRegion(frame)).toBeUndefined();
    const first = slices[0]!;
    const gapAfterFirstSlice = clientPointForStackedText(
      frame,
      0,
      { x: first.box.x + first.box.width + 1, y: first.box.y + first.box.height / 2 },
      METRICS,
    );
    expect(hitTestPointer(frame, gapAfterFirstSlice, METRICS).ok).toBe(false);
  });

  test('whitespace-only paragraph double-click selects full block via paragraph ownership', () => {
    const frame = publishFrame(modelWith(['   ']));
    const block = frame.semanticIndex.stories[0]!.blocks[0]!;
    const para = frame.semanticIndex.ownershipRegions.find((r) => r.kind === 'paragraph' && r.box);
    if (!para?.box) throw new Error('paragraph ownership');
    expect(frame.semanticIndex.ownershipRegions.find((r) => r.kind === 'lineWhitespace')?.box).toBeUndefined();
    const point = clientPointForStackedText(
      frame,
      para.pageIndex ?? 0,
      { x: para.box.x + para.box.width * 0.5, y: para.box.y + para.box.height * 0.5 },
      METRICS,
    );
    const plan = planInteraction(
      { frame, editable: true, readOnly: false, hostMetrics: METRICS },
      { kind: 'click', frameId: frame.id, clientPoint: point, clickCount: 2 },
    );
    const sync = plan.effects[0];
    expect(sync?.kind).toBe('syncSelection');
    if (sync?.kind !== 'syncSelection') throw new Error('sync');
    expect(sync.selection.anchor.graphemeOffset).toBe(0);
    expect(sync.selection.head.graphemeOffset).toBe(block.graphemeCount);
  });

  test('singular sidecar transform fails closed for geometry caret overlay', () => {
    const model = modelWith(['ab cd']);
    const layout = layoutBody(model, LAYOUT);
    const { display, semanticIndex, navigationGeometry } = toDisplayPages(model, layout.pages);
    const store = new InteractionFrameStore();
    const tamperedNav = freezeNavigationGeometry({
      ...navigationGeometry,
      visualLines: navigationGeometry.visualLines.map((line) => ({
        ...line,
        edges: line.edges.map((edge) => ({
          ...edge,
          interaction: {
            ...edge.interaction,
            transform: { a: 0, b: 0, c: 0, d: 0, tx: 0, ty: 0 },
          },
        })),
      })),
    });
    const frame = store.publishLayout({
      modelRevision: 1,
      resourceEpoch: 0,
      configurationEpoch: 0,
      display,
      semanticIndex,
      navigationGeometry: tamperedNav,
      selection: null,
      caret: null,
      selectionGeometry: null,
      focus: { scope: { kind: 'body' }, focused: true },
      composition: { active: false, scope: null },
      currentPage: { viewport: 0, caret: 0 },
    });
    const textLine = tamperedNav.visualLines.find((line) => line.edges.some((edge) => edge.target.graphemeOffset === 1));
    expect(textLine).toBeDefined();
    expect(caretOverlayForTarget(frame, tamperedNav, textLine!.edges.find((e) => e.target.graphemeOffset === 1)!.target)).toBeNull();
  });
});

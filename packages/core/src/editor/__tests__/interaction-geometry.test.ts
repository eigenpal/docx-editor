// Hit testing, caret, and selection geometry tests (interactive-paginated-editing 3.6–3.9).

import { describe, expect, test } from 'bun:test';
import { bodyStoryId } from '@docx-editor.dev/engine-core';
import { contentToClient } from '../coordinate-mapper.ts';
import {
  deriveCaretGeometry,
  deriveSelectionGeometry,
  hitTestPointer,
} from '../interaction-geometry.ts';
import type { InteractionFrame } from '@docx-editor.dev/core-contract/contracts/interaction';
import {
  LAYOUT,
  clientPointForStackedText,
  modelWith,
  modelWithTableCell,
  publishFrame,
  selectionForBlock,
} from './interaction-test-helpers.ts';

const METRICS_OFFSET = {
  clientOrigin: { x: 40, y: 60 },
  scrollOffset: { x: 12, y: 8 },
  zoom: 1.5,
};

function clientOnCluster(
  frame: InteractionFrame,
  pageIndex: number,
  clusterBox: { x: number; y: number; width: number; height: number },
  xRatio = 0.5,
  metrics = METRICS_OFFSET
) {
  return clientPointForStackedText(
    frame,
    pageIndex,
    { x: clusterBox.x + clusterBox.width * xRatio, y: clusterBox.y + clusterBox.height / 2 },
    metrics
  );
}

describe('interaction geometry', () => {
  test('requires explicit host metrics for client pointer resolution', () => {
    const frame = publishFrame(modelWith(['ab']));
    const item = frame.display[0]!.items.find((i) => i.kind === 'text');
    if (item?.kind !== 'text') throw new Error('text');
    const cluster = item.clusters[0]!;
    const content = {
      x: frame.pageGeometry[0]!.box.x + cluster.box.x + cluster.box.width * 0.25,
      y: frame.pageGeometry[0]!.box.y + cluster.box.y + cluster.box.height / 2,
    };
    const client = contentToClient(content, METRICS_OFFSET);
    if (!client.ok) throw new Error('client');
    expect(hitTestPointer(frame, client.value).ok).toBe(false);
    expect(hitTestPointer(frame, client.value, METRICS_OFFSET).ok).toBe(true);
  });

  test('exact equidistant grapheme-edge tie prefers downstream affinity', () => {
    const frame = publishFrame(modelWith(['ab']));
    const item = frame.display[0]!.items.find((i) => i.kind === 'text');
    if (item?.kind !== 'text') throw new Error('text');
    expect(item.clusters).toHaveLength(2);
    const left = item.clusters[0]!;
    const right = item.clusters[1]!;
    const leftEdgeX = left.box.x + left.box.width;
    const rightEdgeX = right.box.x + right.box.width;
    const tieX = (leftEdgeX + rightEdgeX) / 2;
    const y = left.box.y + left.box.height / 2;
    expect(Math.abs(tieX - leftEdgeX)).toBe(Math.abs(rightEdgeX - tieX));
    const outcome = hitTestPointer(
      frame,
      clientPointForStackedText(frame, 0, { x: tieX, y }, METRICS_OFFSET),
      METRICS_OFFSET
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok || outcome.value.target.kind !== 'text') throw new Error('hit');
    expect(outcome.value.target.graphemeOffset).toBe(2);
    expect(outcome.value.target.affinity).toBe('downstream');
  });

  test('combining mark stays one grapheme with strict cluster and caret-stop counts', () => {
    const text = 'e\u0301';
    const frame = publishFrame(modelWith([text]));
    const item = frame.display[0]!.items.find((i) => i.kind === 'text');
    if (item?.kind !== 'text') throw new Error('text');
    expect(item.clusters).toHaveLength(1);
    expect(item.clusters[0]!.graphemeTo - item.clusters[0]!.graphemeFrom).toBe(1);
    expect(item.clusters[0]!.utf16To - item.clusters[0]!.utf16From).toBe(text.length);
    const block = frame.semanticIndex.stories[0]!.blocks[0]!;
    expect(
      frame.semanticIndex.caretStops.filter(
        (s) => s.target.kind === 'text' && s.target.identity.blockId === block.identity.blockId
      )
    ).toHaveLength(block.graphemeCount + 1);
    const cluster = item.clusters[0]!;
    const outcome = hitTestPointer(
      frame,
      clientPointForStackedText(
        frame,
        0,
        { x: cluster.box.x + cluster.box.width - 0.5, y: cluster.box.y + cluster.box.height / 2 },
        METRICS_OFFSET
      ),
      METRICS_OFFSET
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok || outcome.value.target.kind !== 'text') throw new Error('hit');
    expect(outcome.value.target.graphemeOffset).toBe(1);
  });

  test('surrogate pair stays one grapheme with strict UTF-16 span', () => {
    const text = '😀';
    const frame = publishFrame(modelWith([text]));
    const item = frame.display[0]!.items.find((i) => i.kind === 'text');
    if (item?.kind !== 'text') throw new Error('text');
    expect(item.clusters).toHaveLength(1);
    expect(item.clusters[0]!.utf16To - item.clusters[0]!.utf16From).toBe(2);
    expect(item.clusters[0]!.graphemeTo - item.clusters[0]!.graphemeFrom).toBe(1);
  });

  test('reverse z-order selects top eligible identity and skips synthetic/transparent layers', () => {
    const frame = publishFrame(modelWith(['low', 'high']));
    const page = frame.display[0]!;
    const low = page.items.find(
      (i) => i.kind === 'text' && i.semantic.identity.blockId !== page.items.at(-1)?.kind
    ) as Extract<(typeof page.items)[number], { kind: 'text' }>;
    const high = page.items.filter((i) => i.kind === 'text').at(-1) as Extract<
      (typeof page.items)[number],
      { kind: 'text' }
    >;
    const lowBox = low.box;
    const highBox = {
      ...high.box,
      x: lowBox.x,
      y: lowBox.y,
      width: lowBox.width,
      height: lowBox.height,
    };
    const display = [
      {
        ...page,
        items: [
          { ...low, box: lowBox, interaction: { ...low.interaction!, zOrder: 1 } },
          {
            kind: 'decoration' as const,
            box: highBox,
            role: 'comment',
            refId: 'c1',
            interaction: {
              pageIndex: 0,
              zOrder: 50,
              pointerTransparent: true,
              role: 'annotation' as const,
              writingDirection: 'ltr' as const,
              writingMode: 'horizontal-tb' as const,
            },
          },
          {
            ...high,
            box: highBox,
            synthetic: true,
            interaction: { ...high.interaction!, zOrder: 99 },
          },
          { ...high, box: highBox, interaction: { ...high.interaction!, zOrder: 100 } },
        ],
      },
    ];
    const patched = { ...frame, display };
    const point = clientOnCluster(patched, 0, highBox, 0.5);
    const outcome = hitTestPointer(patched, point, METRICS_OFFSET);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok || outcome.value.target.kind !== 'text') throw new Error('hit');
    expect(outcome.value.target.identity.blockId).toBe(high.semantic.identity.blockId);
  });

  test('clip rejects outside points and accepts inside clipped region', () => {
    const frame = publishFrame(modelWith(['clip']));
    const item = frame.display[0]!.items.find((i) => i.kind === 'text');
    if (item?.kind !== 'text') throw new Error('text');
    const clip = { x: item.box.x + 5, y: item.box.y, width: 20, height: item.box.height };
    const clipped = {
      ...item,
      interaction: { ...item.interaction!, clip, zOrder: item.interaction!.zOrder },
    };
    const display = [{ ...frame.display[0]!, items: [clipped] }];
    const patched = { ...frame, display };
    const outside = hitTestPointer(
      patched,
      clientPointForStackedText(
        patched,
        0,
        { x: item.box.x + 1, y: item.box.y + 2 },
        METRICS_OFFSET
      ),
      METRICS_OFFSET
    );
    expect(outside.ok).toBe(false);
    const inside = hitTestPointer(
      patched,
      clientPointForStackedText(patched, 0, { x: clip.x + 2, y: clip.y + 2 }, METRICS_OFFSET),
      METRICS_OFFSET
    );
    expect(inside.ok).toBe(true);
  });

  test('non-singular transform hit and caret land in stacked content space', () => {
    const frame = publishFrame(modelWith(['rot']));
    const item = frame.display[0]!.items.find((i) => i.kind === 'text');
    if (item?.kind !== 'text') throw new Error('text');
    const transform = { a: 1, b: 0.2, c: 0, d: 1, tx: 8, ty: 4 };
    const transformed = {
      ...item,
      interaction: { ...item.interaction!, transform, zOrder: item.interaction!.zOrder },
    };
    const display = [{ ...frame.display[0]!, items: [transformed] }];
    const patched = { ...frame, display };
    const point = clientPointForStackedText(
      patched,
      0,
      { x: item.box.x + 10, y: item.box.y + 5 },
      METRICS_OFFSET
    );
    const hit = hitTestPointer(patched, point, METRICS_OFFSET);
    expect(hit.ok).toBe(true);
    const target = {
      kind: 'text' as const,
      scope: { kind: 'body' as const },
      identity: item.semantic.identity,
      graphemeOffset: 0,
      affinity: 'downstream' as const,
    };
    const caret = deriveCaretGeometry(patched, target);
    expect(caret).not.toBeNull();
    expect(caret!.rect.y).toBeGreaterThanOrEqual(frame.pageGeometry[0]!.box.y);
    expect(caret!.transform).toEqual(transform);
  });

  test('read-only table cell hit is selectable and produces no editable caret', () => {
    const frame = publishFrame(modelWithTableCell('locked'));
    const item = frame.display
      .flatMap((p) => p.items)
      .find((i) => i.kind === 'text' && i.semantic.identity.blockId === 'p-cell');
    if (item?.kind !== 'text') throw new Error('text');
    const pageIndex = frame.display.find((p) => p.items.includes(item))!.index;
    const hit = hitTestPointer(
      frame,
      clientPointForStackedText(
        frame,
        pageIndex,
        { x: item.box.x + 2, y: item.box.y + 2 },
        METRICS_OFFSET
      ),
      METRICS_OFFSET
    );
    expect(hit.ok).toBe(true);
    if (!hit.ok) throw new Error('hit');
    expect(hit.value.role).toBe('selectableText');
    expect(
      deriveCaretGeometry(frame, {
        kind: 'text',
        scope: { kind: 'body' },
        identity: { storyId: bodyStoryId(modelWithTableCell('locked')), blockId: 'p-cell' },
        graphemeOffset: 0,
        affinity: 'downstream',
      })
    ).toBeNull();
  });

  test('multi-page line selection retains complete semantic selection with viewport-limited rects', () => {
    const words = Array.from({ length: 80 }, (_, i) => `word${i}`).join(' ');
    const model = modelWith([words]);
    const frame = publishFrame(model, { layout: { ...LAYOUT, pageHeight: 4000 } });
    expect(frame.display.length).toBeGreaterThan(1);
    const block = frame.semanticIndex.stories[0]!.blocks[0]!;
    const selection = selectionForBlock(frame, block.identity.blockId, 0, 400);
    const full = deriveSelectionGeometry(frame, selection);
    expect(full.ok).toBe(true);
    if (!full.ok) throw new Error('selection');
    expect(full.value.selection.head.graphemeOffset).toBe(400);
    expect(full.value.rects.length).toBeGreaterThan(0);
    expect(full.value.pageIndices.some((i) => i > 0)).toBe(true);
    const visibleOnly = deriveSelectionGeometry(frame, selection, { visiblePageIndices: [0] });
    expect(visibleOnly.ok).toBe(true);
    if (!visibleOnly.ok) throw new Error('visible');
    expect(visibleOnly.value.selection).toEqual(selection);
    expect(visibleOnly.value.pageIndices.every((i) => i === 0)).toBe(true);
    expect(visibleOnly.value.rects.length).toBeLessThan(full.value.rects.length);
  });

  test('rejects non-horizontal writing modes', () => {
    const frame = publishFrame(modelWith(['vert']));
    const item = frame.display[0]!.items.find((i) => i.kind === 'text');
    if (item?.kind !== 'text') throw new Error('text');
    const vertical = {
      ...item,
      interaction: { ...item.interaction!, writingMode: 'vertical-rl' as const },
    };
    const display = [{ ...frame.display[0]!, items: [vertical] }];
    const patched = { ...frame, display };
    const outcome = hitTestPointer(
      patched,
      clientPointForStackedText(
        patched,
        0,
        { x: item.box.x + 2, y: item.box.y + 2 },
        METRICS_OFFSET
      ),
      METRICS_OFFSET
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('expected unsupported');
    expect(outcome.code).toBe('unsupported');
  });

  test('singular transform fails closed', () => {
    const frame = publishFrame(modelWith(['x']));
    const item = frame.display[0]!.items.find((i) => i.kind === 'text');
    if (item?.kind !== 'text') throw new Error('text');
    const broken = {
      ...item,
      interaction: {
        ...item.interaction!,
        transform: { a: 0, b: 0, c: 0, d: 0, tx: 0, ty: 0 },
      },
    };
    const patched = { ...frame, display: [{ ...frame.display[0]!, items: [broken] }] };
    const outcome = hitTestPointer(
      patched,
      clientPointForStackedText(
        patched,
        0,
        { x: item.box.x + 1, y: item.box.y + 1 },
        METRICS_OFFSET
      ),
      METRICS_OFFSET
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.code).toBe('invalidTarget');
  });

  test('run and line selection geometry clips to transformed stacked bounds', () => {
    const frame = publishFrame(modelWith(['alpha beta', 'gamma']));
    const block = frame.semanticIndex.stories[0]!.blocks[0]!;
    const selection = selectionForBlock(frame, block.identity.blockId, 0, 6);
    const geometry = deriveSelectionGeometry(frame, selection);
    expect(geometry.ok).toBe(true);
    if (!geometry.ok) throw new Error('selection');
    expect(geometry.value.selection).toEqual(selection);
    expect(geometry.value.rects.length).toBeGreaterThan(0);
    for (const rect of geometry.value.rects) {
      expect(rect.y).toBeGreaterThanOrEqual(frame.pageGeometry[0]!.box.y);
    }
  });

  test('stale frame identity is rejected', () => {
    const frame = publishFrame();
    const outcome = hitTestPointer(frame, { x: 0, y: 0 }, METRICS_OFFSET, {
      frameId: { value: frame.id.value - 1 },
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.code).toBe('staleFrame');
  });
});

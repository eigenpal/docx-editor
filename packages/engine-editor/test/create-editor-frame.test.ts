// createEditor interaction-frame integration (interactive-paginated-editing 2.2–2.4).

import { describe, expect, test } from 'bun:test';
import { createTestEditor as createEditor } from './create-test-editor.ts';
import type { EditorHost } from '@docx-editor.dev/core-contract/contracts/editor';
import type { InteractionHostMetrics } from '@docx-editor.dev/core-contract/contracts/interaction';
import { createEmptyModel, writeDocx } from '@docx-editor.dev/engine-core';
import { createDeterministicLayoutShaping } from '@docx-editor.dev/engine-layout';
import { contentToClient } from '../src/coordinate-mapper.ts';
import { frameMembersCoherent } from '../src/interaction-frame.ts';
import { modelWith, publishFrameBundle, selectionForBlock } from './interaction-test-helpers.ts';

const METRICS: InteractionHostMetrics = {
  clientOrigin: { x: 32, y: 48 },
  scrollOffset: { x: 8, y: 16 },
  zoom: 1.25,
};

const docxBytes = (): Uint8Array => writeDocx(createEmptyModel());
const docxWithText = (): Uint8Array => writeDocx(modelWith(['hello world']));

function makeSyncHost(metrics: InteractionHostMetrics | null = null): EditorHost {
  return {
    getBodyHostEl: () => null,
    getHfHostEl: () => null,
    getPagesContainer: () => null,
    getScrollContainer: () => null,
    getInteractionHostMetrics: metrics ? () => metrics : undefined,
    scheduleFrame: (cb) => {
      cb();
      return () => {};
    },
  };
}

function makeControllableHost() {
  const queue: Array<() => void> = [];
  let cancel: (() => void) | null = null;
  const host: EditorHost = {
    getBodyHostEl: () => null,
    getHfHostEl: () => null,
    getPagesContainer: () => null,
    getScrollContainer: () => null,
    scheduleFrame: (cb) => {
      cancel?.();
      queue.push(cb);
      const thisCancel = () => {
        const idx = queue.indexOf(cb);
        if (idx >= 0) queue.splice(idx, 1);
      };
      cancel = thisCancel;
      return thisCancel;
    },
  };
  return {
    host,
    flush: () => {
      const cb = queue.shift();
      cb?.();
    },
    pendingCount: () => queue.length,
  };
}

describe('createEditor interaction frame', () => {
  test('getInteractionFrame exposes coherent display and geometry from one publication', () => {
    const editor = createEditor({ host: makeSyncHost(), document: docxBytes() });
    const frame = editor.getInteractionFrame();
    expect(frame.display).toEqual(editor.getDisplay());
    expect(frame.pageGeometry).toEqual(editor.getPageGeometry());
    expect(frame.scrollGeometry).toEqual(editor.getScrollGeometry());
    expect(frame.id).toEqual(editor.getInteractionFrame().id);
    expect(frameMembersCoherent(frame)).toBe(true);
    editor.destroy();
  });

  test('publishes resource and configuration epochs from the immutable layout operation', () => {
    const base = createDeterministicLayoutShaping();
    const layoutShaping = {
      ...base,
      fonts: {
        epoch: 17,
        resolve: base.fonts.resolve,
      },
      operation: {
        ...base.operation,
        resourceEpoch: 17,
        configEpoch: 23,
        shapingHash: 'shape:fixture-provenance',
      },
    };
    const editor = createEditor({
      host: makeSyncHost(),
      document: docxWithText(),
      layoutShaping,
    });
    const frame = editor.getInteractionFrame();
    expect(frame.revisions).toMatchObject({
      resourceEpoch: 17,
      configurationEpoch: 23,
      shapingProvenance: {
        extensionFingerprint: 'test:none',
        shapingHash: expect.any(String),
        producerVersion: expect.any(Number),
      },
    });
    expect(frame.display[0]?.items[0]?.kind).toBe('text');
    if (frame.display[0]?.items[0]?.kind === 'text') {
      expect(frame.display[0].items[0].runs[0]?.producer).toMatchObject({
        resourceEpoch: 17,
        configEpoch: 23,
        shapingHash: expect.any(String),
      });
    }
    editor.destroy();
  });

  test('loaded interaction frame carries model-derived semantic blocks coherent with display', () => {
    const editor = createEditor({ host: makeSyncHost(), document: docxBytes() });
    const frame = editor.getInteractionFrame();
    expect(frame.semanticIndex.stories[0]!.blocks.length).toBeGreaterThan(0);
    expect(frame.semanticIndex.ownershipRegions.some((r) => r.kind === 'paragraph')).toBe(true);
    const painted = frame.display.flatMap((p) => p.items).filter((i) => i.kind === 'text');
    if (painted[0]?.kind === 'text') {
      const blockIds = new Set(
        frame.semanticIndex.stories[0]!.blocks.map((b) => b.identity.blockId)
      );
      expect(blockIds.has(painted[0].semantic.identity.blockId)).toBe(true);
    }
    expect(frameMembersCoherent(frame)).toBe(true);
    editor.destroy();
  });

  test('caret and selection geometry derive on demand when no selection is set', () => {
    const editor = createEditor({ host: makeSyncHost(), document: docxBytes() });
    expect(editor.getCaretGeometry()).toBeNull();
    expect(editor.getSelectionGeometry()).toBeNull();
    expect(editor.getCaretRect()).toBeNull();
    expect(editor.getSelectionRects()).toEqual([]);
    editor.destroy();
  });

  test('getScrollGeometry exposes frame scroll geometry including pageGapPx', () => {
    const editor = createEditor({ host: makeSyncHost(), document: docxBytes() });
    const frame = editor.getInteractionFrame();
    const scroll = editor.getScrollGeometry();
    expect(scroll).toEqual(frame.scrollGeometry);
    expect(typeof scroll.pageGapPx).toBe('number');
    expect(scroll.pageGapPx).toBeGreaterThan(0);
    editor.destroy();
  });

  test('getSelectionGeometry and getSelectionRects honor visiblePageIndices', () => {
    const editor = createEditor({ host: makeSyncHost(), document: docxWithText() });
    const frame = editor.getInteractionFrame();
    const block = frame.semanticIndex.stories[0]!.blocks[0]!;
    const selection = {
      frameId: frame.id,
      scope: { kind: 'body' as const },
      anchor: {
        kind: 'text' as const,
        scope: { kind: 'body' as const },
        identity: block.identity,
        graphemeOffset: 0,
        affinity: 'upstream' as const,
      },
      head: {
        kind: 'text' as const,
        scope: { kind: 'body' as const },
        identity: block.identity,
        graphemeOffset: 5,
        affinity: 'upstream' as const,
      },
    };
    const full = editor.getSelectionGeometry(selection);
    expect(full?.selection).toEqual(selection);
    expect(full?.rects.length).toBeGreaterThan(0);
    const offscreen = editor.getSelectionGeometry(selection, { visiblePageIndices: [99] });
    expect(offscreen?.selection).toEqual(selection);
    expect(offscreen?.rects).toEqual([]);
    expect(editor.getSelectionRects(selection, { visiblePageIndices: [99] })).toEqual([]);
    expect(editor.getSelectionRects(selection).length).toBe(full?.rects.length);
    editor.destroy();
  });

  test('resolvePointer hit-tests painted text with explicit host metrics', () => {
    const editor = createEditor({ host: makeSyncHost(), document: docxBytes() });
    const frame = editor.getInteractionFrame();
    const item = frame.display[0]?.items.find((i) => i.kind === 'text');
    if (item?.kind !== 'text') throw new Error('text');
    const cluster = item.clusters[0] ?? { box: item.box };
    const stacked = frame.pageGeometry[0]!.box;
    const content = {
      x: stacked.x + cluster.box.x + cluster.box.width * 0.25,
      y: stacked.y + cluster.box.y + cluster.box.height / 2,
    };
    const client = contentToClient(content, METRICS);
    if (!client.ok) throw new Error('client');
    expect(editor.resolvePointer(client.value).ok).toBe(false);
    const outcome = editor.resolvePointer(client.value, { hostMetrics: METRICS });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error('hit');
    expect(outcome.value.role).toBe('editableText');
    editor.destroy();
  });

  test('resolvePointer accepts host-provided metrics callback under scroll and zoom', () => {
    const editor = createEditor({ host: makeSyncHost(METRICS), document: docxBytes() });
    const frame = editor.getInteractionFrame();
    const item = frame.display[0]?.items.find((i) => i.kind === 'text');
    if (item?.kind !== 'text') throw new Error('text');
    const cluster = item.clusters[0] ?? { box: item.box };
    const stacked = frame.pageGeometry[0]!.box;
    const content = {
      x: stacked.x + cluster.box.x + 2,
      y: stacked.y + cluster.box.y + cluster.box.height / 2,
    };
    const client = contentToClient(content, METRICS);
    if (!client.ok) throw new Error('client');
    const outcome = editor.resolvePointer(client.value);
    expect(outcome.ok).toBe(true);
    editor.destroy();
  });

  test('stale frame identity is rejected with a typed outcome', () => {
    const editor = createEditor({ host: makeSyncHost(), document: docxBytes() });
    const stale = { value: editor.getInteractionFrame().id.value - 1 };
    const outcome = editor.resolvePointer({ x: 0, y: 0 }, { frameId: stale });
    expect(outcome).toMatchObject({ ok: false, code: 'staleFrame' });
    editor.destroy();
  });

  test('relayout({ sync: false }) retains the prior frame and rejects pointer input as pending', () => {
    const { host, flush, pendingCount } = makeControllableHost();
    const editor = createEditor({ host, document: docxBytes() });
    const before = editor.getInteractionFrame();
    editor.relayout({ sync: false });
    const during = editor.getInteractionFrame();
    expect(during.id).toEqual(before.id);
    expect(during.display).toBe(before.display);
    expect(during.completeness.kind).toBe('pending');
    expect(during.completeness).toMatchObject({ awaiting: 'layout' });
    expect(pendingCount()).toBe(1);
    const pendingPointer = editor.resolvePointer({ x: 5, y: 5 });
    expect(pendingPointer).toMatchObject({ ok: false, code: 'pendingLayout' });
    flush();
    const after = editor.getInteractionFrame();
    expect(after.id.value).not.toBe(before.id.value);
    expect(after.completeness.kind).toBe('complete');
    editor.destroy();
  });

  test('superseded async relayout cancels older scheduled completion', () => {
    const { host, flush, pendingCount } = makeControllableHost();
    const editor = createEditor({ host, document: docxBytes() });
    const before = editor.getInteractionFrame();
    editor.relayout({ sync: false });
    editor.relayout({ sync: false });
    expect(pendingCount()).toBe(1);
    flush();
    const after = editor.getInteractionFrame();
    expect(after.completeness.kind).toBe('complete');
    expect(after.id.value).not.toBe(before.id.value);
    editor.destroy();
  });

  test('destroy cancels pending scheduled layout work', () => {
    const { host, flush, pendingCount } = makeControllableHost();
    const editor = createEditor({ host, document: docxBytes() });
    editor.relayout({ sync: false });
    expect(pendingCount()).toBe(1);
    editor.destroy();
    flush();
    expect(pendingCount()).toBe(0);
  });
});

describe('a missing caret rectangle must not discard focus (re-review, HIGH)', () => {
  test('publishSelection keeps focus and selection when caret geometry is null', () => {
    const { frame, store } = publishFrameBundle(modelWith(['hello world']));
    const blockId = frame.semanticIndex.stories[0]!.blocks[0]!.identity.blockId;
    const selection = selectionForBlock(frame, blockId, 3, 3);

    // Exactly the shape reconcileSelectionOverlayAfterLayout produces when
    // deriveCaretGeometry fails: a live selection and focus, no caret rect.
    const published = store.publishSelection({
      modelRevision: frame.revisions.modelRevision,
      layoutRevision: frame.revisions.layoutRevision,
      selection,
      caret: null,
      selectionGeometry: null,
      focus: { scope: { kind: 'body' }, focused: true },
      composition: { active: false, scope: null },
      currentPage: { viewport: 0, caret: 0 },
    });

    // The old code bailed instead of publishing, so the frame kept the layout
    // seed's focused:false / selection:null. Every later geometry key was then
    // refused for "requires a focused interaction frame", and once refused keys
    // stopped falling through to ProseMirror the caret became immovable.
    expect(published.focus.focused).toBe(true);
    expect(published.selection).not.toBeNull();
    expect(published.selection!.head).toMatchObject({ graphemeOffset: 3 });
    // No caret rect means paint no caret — not lose the selection.
    expect(published.caret).toBeNull();
  });
});

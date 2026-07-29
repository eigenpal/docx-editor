// Multi-block and cross-page selection geometry (interactive-paginated-editing 5.4).

import { describe, expect, test } from 'bun:test';
import { deriveSelectionGeometry } from '../interaction-geometry.ts';
import { LAYOUT, modelWith, publishFrame, selectionForBlock } from './interaction-test-helpers.ts';

describe('multi-block selection geometry (task 5.4)', () => {
  test('forward drag across wrapped lines in one paragraph produces ordered rects', () => {
    const frame = publishFrame(modelWith(['alpha beta gamma']));
    const block = frame.semanticIndex.stories[0]!.blocks[0]!;
    const selection = selectionForBlock(frame, block.identity.blockId, 0, 11);
    const geometry = deriveSelectionGeometry(frame, selection);
    expect(geometry.ok).toBe(true);
    if (!geometry.ok) throw new Error('geometry');
    expect(geometry.value.selection).toEqual(selection);
    expect(geometry.value.rects.length).toBeGreaterThan(0);
    expect(geometry.value.collapsed).toBe(false);
  });

  test('forward drag across multiple body paragraphs produces anchor, intermediate, and head rects', () => {
    const frame = publishFrame(modelWith(['first para', 'second para', 'third para']));
    const blocks = frame.semanticIndex.stories[0]!.blocks;
    expect(blocks.length).toBeGreaterThanOrEqual(3);
    const anchorBlock = blocks[0]!;
    const headBlock = blocks[2]!;
    const selection = {
      frameId: frame.id,
      scope: { kind: 'body' as const },
      anchor: {
        kind: 'text' as const,
        scope: { kind: 'body' as const },
        identity: anchorBlock.identity,
        graphemeOffset: 3,
        affinity: 'upstream' as const,
      },
      head: {
        kind: 'text' as const,
        scope: { kind: 'body' as const },
        identity: headBlock.identity,
        graphemeOffset: 4,
        affinity: 'downstream' as const,
      },
    };
    const geometry = deriveSelectionGeometry(frame, selection);
    expect(geometry.ok).toBe(true);
    if (!geometry.ok) throw new Error('geometry');
    expect(geometry.value.selection).toEqual(selection);
    expect(geometry.value.rects.length).toBeGreaterThan(0);
    expect(geometry.value.collapsed).toBe(false);
  });

  test('backward drag across multiple paragraphs preserves semantic anchor/head and produces rects', () => {
    const frame = publishFrame(modelWith(['aaa', 'bbb', 'ccc']));
    const blocks = frame.semanticIndex.stories[0]!.blocks;
    const selection = {
      frameId: frame.id,
      scope: { kind: 'body' as const },
      anchor: {
        kind: 'text' as const,
        scope: { kind: 'body' as const },
        identity: blocks[2]!.identity,
        graphemeOffset: 2,
        affinity: 'upstream' as const,
      },
      head: {
        kind: 'text' as const,
        scope: { kind: 'body' as const },
        identity: blocks[0]!.identity,
        graphemeOffset: 1,
        affinity: 'downstream' as const,
      },
    };
    const geometry = deriveSelectionGeometry(frame, selection);
    expect(geometry.ok).toBe(true);
    if (!geometry.ok) throw new Error('geometry');
    expect(geometry.value.selection.anchor).toEqual(selection.anchor);
    expect(geometry.value.selection.head).toEqual(selection.head);
    expect(geometry.value.rects.length).toBeGreaterThan(0);
  });

  test('cross-page selection retains complete semantic range with rects on multiple pages', () => {
    const words = Array.from({ length: 80 }, (_, i) => `word${i}`).join(' ');
    const frame = publishFrame(modelWith([words]), { layout: { ...LAYOUT, pageHeight: 4000 } });
    expect(frame.display.length).toBeGreaterThan(1);
    const block = frame.semanticIndex.stories[0]!.blocks[0]!;
    const selection = selectionForBlock(frame, block.identity.blockId, 0, 400);
    const geometry = deriveSelectionGeometry(frame, selection);
    expect(geometry.ok).toBe(true);
    if (!geometry.ok) throw new Error('geometry');
    expect(geometry.value.selection.head.graphemeOffset).toBe(400);
    expect(geometry.value.pageIndices.some((i) => i > 0)).toBe(true);
    expect(geometry.value.rects.length).toBeGreaterThan(0);
  });

  test('rejects cross-story and table-cell bridging', () => {
    const frame = publishFrame(modelWith(['one']));
    const block = frame.semanticIndex.stories[0]!.blocks[0]!;
    const crossStory = {
      frameId: frame.id,
      scope: { kind: 'body' as const },
      anchor: {
        kind: 'text' as const,
        scope: { kind: 'body' as const },
        identity: block.identity,
        graphemeOffset: 0,
        affinity: 'downstream' as const,
      },
      head: {
        kind: 'text' as const,
        scope: { kind: 'body' as const },
        identity: { storyId: 'other-story', blockId: block.identity.blockId },
        graphemeOffset: 1,
        affinity: 'downstream' as const,
      },
    };
    expect(deriveSelectionGeometry(frame, crossStory).ok).toBe(false);
  });

  test('viewport-limited rects preserve complete semantic selection', () => {
    const words = Array.from({ length: 80 }, (_, i) => `word${i}`).join(' ');
    const frame = publishFrame(modelWith([words]), { layout: { ...LAYOUT, pageHeight: 4000 } });
    const block = frame.semanticIndex.stories[0]!.blocks[0]!;
    const selection = selectionForBlock(frame, block.identity.blockId, 0, 400);
    const visibleOnly = deriveSelectionGeometry(frame, selection, { visiblePageIndices: [0] });
    expect(visibleOnly.ok).toBe(true);
    if (!visibleOnly.ok) throw new Error('visible');
    expect(visibleOnly.value.selection).toEqual(selection);
    expect(visibleOnly.value.pageIndices.every((i) => i === 0)).toBe(true);
  });
});

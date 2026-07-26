import { describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { InteractionFrame, SemanticTarget } from '@docx-editor.dev/core-contract/interaction';
import * as engineEditor from '../src/index.ts';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

const FRAME_ID = { value: 7 } as const;

function frame(): InteractionFrame {
  return {
    id: FRAME_ID,
    revisions: {
      modelRevision: 3,
      layoutRevision: 5,
      resourceEpoch: 0,
      configurationEpoch: 0,
    },
    completeness: { kind: 'complete' },
    display: [
      {
        index: 0,
        box: { x: 0, y: 0, width: 800, height: 1000 },
        items: [
          {
            kind: 'text',
            scope: { kind: 'body' },
            box: { x: 40, y: 16, width: 50, height: 18 },
            runs: [
              {
                text: 'Bo',
                box: { x: 40, y: 16, width: 25, height: 18 },
                fontFamily: 'Helvetica',
                fontSizePx: 16,
                color: { kind: 'rgb', r: 0, g: 0, b: 0 },
                bold: true,
              },
              {
                text: 'ld',
                box: { x: 65, y: 16, width: 25, height: 18 },
                fontFamily: 'Helvetica',
                fontSizePx: 16,
                color: { kind: 'rgb', r: 0, g: 0, b: 0 },
              },
            ],
            semantic: {
              scope: { kind: 'body' },
              identity: { storyId: 'story-1', blockId: 'paragraph-1' },
              graphemeFrom: 0,
              graphemeTo: 4,
              utf16From: 0,
              utf16To: 4,
            },
            clusters: Array.from({ length: 4 }, (_, index) => ({
              clusterIndex: index,
              graphemeFrom: index,
              graphemeTo: index + 1,
              utf16From: index,
              utf16To: index + 1,
              box: { x: 40 + index * 12.5, y: 16, width: 12.5, height: 18 },
              logicalOrder: index,
              direction: 'ltr' as const,
              affinity: 'downstream' as const,
            })),
            interaction: {
              pageIndex: 0,
              zOrder: 0,
              writingDirection: 'ltr',
              writingMode: 'horizontal-tb',
              role: 'editableText',
            },
          },
        ],
      },
    ],
    semanticIndex: { stories: [], caretStops: [], ownershipRegions: [] },
    pageGeometry: [],
    scrollGeometry: { contentHeight: 0, pageTops: [], pageGapPx: 24 },
    selection: null,
    caret: null,
    selectionGeometry: null,
    focus: { scope: { kind: 'body' }, focused: true },
    composition: { active: false, scope: null },
    currentPage: { viewport: 0, caret: 0 },
  };
}

function textTarget(graphemeOffset: number): SemanticTarget {
  return {
    kind: 'text',
    scope: { kind: 'body' },
    identity: { storyId: 'story-1', blockId: 'paragraph-1' },
    graphemeOffset,
    affinity: 'downstream',
  };
}

describe('rendered text geometry port', () => {
  test('exports the DOM geometry realization factory', () => {
    expect(engineEditor).toHaveProperty('createDomRenderedTextGeometryPort');
    expect(
      (engineEditor as Record<string, unknown>).createDomRenderedTextGeometryPort
    ).toBeFunction();
  });

  test('derives distinct semantic ranges for grouped paint runs', () => {
    expect(engineEditor).toHaveProperty('semanticRangeForRun');
    const item = frame().display[0]!.items[0]!;
    if (item.kind !== 'text') throw new Error('Expected text fixture');
    expect(
      (
        engineEditor as typeof engineEditor & {
          semanticRangeForRun: (item: typeof item, runIndex: number) => unknown;
        }
      ).semanticRangeForRun(item, 1)
    ).toEqual({
      utf16From: 2,
      utf16To: 4,
      graphemeFrom: 2,
      graphemeTo: 4,
    });
  });

  test('reads the actual bold DOM range rectangle and refuses stale frames', () => {
    const root = document.createElement('div');
    root.dataset.docxLayoutRevision = '5';
    const run = document.createElement('div');
    run.dataset.docxStoryId = 'story-1';
    run.dataset.docxBlockId = 'paragraph-1';
    run.dataset.docxUtf16From = '0';
    run.dataset.docxUtf16To = '4';
    run.dataset.docxGraphemeFrom = '0';
    run.dataset.docxGraphemeTo = '4';
    run.style.fontWeight = 'bold';
    run.textContent = 'Bold';
    root.append(run);

    const originalCreateRange = document.createRange.bind(document);
    document.createRange = (() => {
      let offset = -1;
      return {
        setStart: (_node: Node, next: number) => {
          offset = next;
        },
        collapse: () => undefined,
        getClientRects: () =>
          [
            {
              x: 40 + offset * 11.25,
              y: 18.5,
              width: 0,
              height: 16.5,
              top: 18.5,
              left: 40 + offset * 11.25,
              right: 40 + offset * 11.25,
              bottom: 35,
              toJSON: () => ({}),
            },
          ] as unknown as DOMRectList,
      } as unknown as Range;
    }) as typeof document.createRange;

    try {
      const current = frame();
      const port = engineEditor.createDomRenderedTextGeometryPort({
        getRoot: () => root,
        getFrame: () => current,
      });
      expect(port.caretRect(textTarget(3), FRAME_ID)).toEqual({
        x: 73.75,
        y: 18.5,
        width: 1,
        height: 16.5,
      });
      expect(port.caretRect(textTarget(3), { value: 6 })).toBeNull();
    } finally {
      document.createRange = originalCreateRange;
    }
  });

  test('both adapters paint overlays directly from the published interaction frame', () => {
    const react = readFileSync(
      join(import.meta.dir, '..', '..', 'react', 'src', 'components', 'DocxEditor.tsx'),
      'utf8'
    );
    const vue = readFileSync(
      join(import.meta.dir, '..', '..', 'vue', 'src', 'DocxEditor.ts'),
      'utf8'
    );
    for (const source of [react, vue]) {
      expect(source).toContain('overlaysForFrame');
      expect(source).not.toContain('createDomRenderedTextGeometryPort');
      expect(source).not.toContain('commitFrame');
      expect(source).not.toContain('getRenderedTextGeometry');
    }
    expect(react).toContain('setOverlays(overlaysForFrame(frame))');
    expect(vue).toContain('overlays.value = overlaysForFrame(frame)');
  });
});

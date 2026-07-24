// Shared helpers for interaction geometry tests (task 3.5–3.9).

import {
  createEmptyModel,
  bodyStoryId,
  DocumentStore,
  ORIGIN_IDS,
  type PackageModel,
  type ParagraphRecord,
  type TableRecord,
} from '@docx-editor.dev/engine-core';
import { layoutBody, HelveticaMetrics } from '@docx-editor.dev/engine-layout';
import type { InteractionFrame, InteractionHostMetrics, SemanticSelection } from '@docx-editor.dev/core-contract/interaction';
import type { Point } from '@docx-editor.dev/core-contract/types';
import { toDisplayPages } from '../src/display-bridge.ts';
import { InteractionFrameStore, buildStackedPageGeometry, DEFAULT_PAGE_GAP_PX } from '../src/interaction-frame.ts';
import { contentToClient, IDENTITY_HOST_METRICS } from '../src/coordinate-mapper.ts';

export const HUMAN = ORIGIN_IDS.mutationHuman;
export const LAYOUT = { pageWidth: 12240, pageHeight: 15840, margin: 1440, metrics: new HelveticaMetrics() };

export function modelWith(texts: string[]): PackageModel {
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

export function modelWithTableCell(cellText: string): PackageModel {
  const base = createEmptyModel();
  const storyId = bodyStoryId(base);
  const story = base.stories.get(storyId)!;
  const table: TableRecord = {
    kind: 'table',
    id: 'tbl-1',
    rows: [{ id: 'row-1', cells: [{ id: 'cell-1', blocks: [{ kind: 'paragraph', id: 'p-cell', runs: [{ text: cellText }] }] }] }],
  };
  return {
    ...base,
    stories: new Map(base.stories).set(storyId, { ...story, blocks: [story.blocks[0]!, table] }),
  };
}

export function modelWithRunSplit(parts: readonly string[]): PackageModel {
  const model = createEmptyModel();
  const storyId = bodyStoryId(model);
  const store = new DocumentStore(model);
  const first = (model.stories.get(storyId)!.blocks[0] as ParagraphRecord).id;
  store.transact(HUMAN, (c) =>
    c.apply({
      op: 'setParagraphRuns',
      paragraphId: first,
      runs: parts.map((text) => ({ text })),
    }),
  );
  return store.currentModel;
}

export function publishFrame(
  model = modelWith(['hello']),
  options: { pageGapPx?: number; layout?: Parameters<typeof layoutBody>[1] } = {},
): InteractionFrame {
  const layout = layoutBody(model, options.layout ?? LAYOUT);
  const bridged = toDisplayPages(model, layout.pages);
  const store = new InteractionFrameStore();
  return store.publishLayout({
    modelRevision: 1,
    resourceEpoch: 0,
    configurationEpoch: 0,
    display: bridged.display,
    semanticIndex: bridged.semanticIndex,
    pageGapPx: options.pageGapPx ?? DEFAULT_PAGE_GAP_PX,
    selection: null,
    caret: null,
    selectionGeometry: null,
    focus: { scope: { kind: 'body' }, focused: false },
    composition: { active: false, scope: null },
    currentPage: { viewport: 0, caret: 0 },
  });
}

export function stackedFrame(pageCount: number, pageGapPx = 24, pageHeight = 1056, pageWidth = 816): InteractionFrame {
  const display = Array.from({ length: pageCount }, (_, index) => ({
    index,
    box: { x: 0, y: 0, width: pageWidth, height: pageHeight },
    items: [] as const,
  }));
  const stacked = buildStackedPageGeometry(display, pageGapPx);
  return {
    id: { value: 1 },
    revisions: { modelRevision: 1, layoutRevision: 1, resourceEpoch: 0, configurationEpoch: 0 },
    completeness: { kind: 'complete' },
    display,
    semanticIndex: { stories: [], caretStops: [], ownershipRegions: [] },
    pageGeometry: stacked.pageGeometry,
    scrollGeometry: stacked.scrollGeometry,
    selection: null,
    caret: null,
    selectionGeometry: null,
    focus: { scope: null, focused: false },
    composition: { active: false, scope: null },
    currentPage: { viewport: 0, caret: 0 },
  };
}

export function clientPointForStackedText(
  frame: InteractionFrame,
  pageIndex: number,
  pageLocal: Point,
  metrics: InteractionHostMetrics = IDENTITY_HOST_METRICS,
): Point {
  const stacked = frame.pageGeometry.find((p) => p.index === pageIndex)?.box;
  if (!stacked) throw new Error('missing stacked page');
  const content = { x: stacked.x + pageLocal.x, y: stacked.y + pageLocal.y };
  const client = contentToClient(content, metrics);
  if (!client.ok) throw new Error(client.reason);
  return client.value;
}

export function selectionForBlock(
  frame: InteractionFrame,
  blockId: string,
  anchorOffset: number,
  headOffset: number,
): SemanticSelection {
  const block = frame.semanticIndex.stories[0]!.blocks.find((b) => b.identity.blockId === blockId)!;
  const target = (graphemeOffset: number) => ({
    kind: 'text' as const,
    scope: { kind: 'body' as const },
    identity: block.identity,
    graphemeOffset,
    affinity: 'upstream' as const,
  });
  return {
    frameId: frame.id,
    scope: { kind: 'body' },
    anchor: target(anchorOffset),
    head: target(headOffset),
  };
}

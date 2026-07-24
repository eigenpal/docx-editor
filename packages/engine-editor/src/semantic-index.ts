// Model-derived semantic position index (interactive-paginated-editing 3.2–3.4).
// Canonical story order, grapheme caret stops, and ownership regions — never display accumulation.

import {
  bodyStoryId,
  isTopLevelEditable,
  type PackageModel,
  type Block,
  type ParagraphRecord,
  type TableRecord,
  type SdtRecord,
} from '@docx-editor.dev/engine-core';
import {
  graphemeCount,
  segmentGraphemes,
  segmentWords,
  resolveDefaultWordBoundary,
  utf16OffsetToGrapheme,
  wordSegmentsToGraphemeRecords,
  type WordBoundary,
} from '@docx-editor.dev/engine-layout';
import type { ViewScope } from '@docx-editor.dev/core-contract/editor';
import type {
  BlockSemanticRecord,
  CaretStop,
  InteractionAffinity,
  InteractionRole,
  OwnershipRegion,
  SemanticIdentity,
  SemanticPositionIndex,
  SemanticTextSpan,
  ShapedCluster,
  StorySemanticIndex,
} from '@docx-editor.dev/core-contract/interaction';
import type { Rect } from '@docx-editor.dev/core-contract/types';

/** Traversal context for capability-owned editability in the body-paragraph lane. */
export interface ParagraphTraversalContext {
  readonly inTopLevelBodyFlow: boolean;
  readonly inTableCell: boolean;
}

interface LocatedParagraph {
  readonly paragraph: ParagraphRecord;
  readonly context: ParagraphTraversalContext;
}

function flattenSdt(blocks: readonly Block[]): Block[] {
  const out: Block[] = [];
  for (const b of blocks) {
    if (b.kind === 'sdt') out.push(...flattenSdt((b as SdtRecord).blocks));
    else out.push(b);
  }
  return out;
}

function walkParagraphs(blocks: readonly Block[], context: ParagraphTraversalContext, out: LocatedParagraph[]): void {
  for (const block of flattenSdt(blocks)) {
    if (block.kind === 'paragraph') {
      out.push({ paragraph: block as ParagraphRecord, context });
      continue;
    }
    if (block.kind === 'table') {
      for (const row of (block as TableRecord).rows) {
        for (const cell of row.cells) {
          walkParagraphs(cell.blocks, { inTopLevelBodyFlow: false, inTableCell: true }, out);
        }
      }
    }
  }
}

function paragraphText(p: ParagraphRecord): string {
  return p.runs.map((r) => r.text).join('');
}

function identity(storyId: string, blockId: string): SemanticIdentity {
  return { storyId, blockId };
}

function textRole(readOnly: boolean): InteractionRole {
  return readOnly ? 'selectableText' : 'editableText';
}

/** Derive editability from traversal context and installed block capabilities — not a global flag. */
export function paragraphEditableInLane(context: ParagraphTraversalContext): boolean {
  if (context.inTableCell) return false;
  if (!context.inTopLevelBodyFlow) return false;
  return isTopLevelEditable('paragraph');
}

export function caretAffinity(graphemeOffset: number, paragraphGraphemeCount: number): InteractionAffinity {
  if (graphemeOffset >= paragraphGraphemeCount) return 'downstream';
  return graphemeOffset === 0 ? 'downstream' : 'upstream';
}

function caretStopsForParagraph(scope: ViewScope, record: BlockSemanticRecord): CaretStop[] {
  if (record.readOnly) return [];
  const role = textRole(false);
  const stops: CaretStop[] = [];
  for (let g = 0; g <= record.graphemeCount; g += 1) {
    stops.push({
      target: {
        kind: 'text',
        scope,
        identity: record.identity,
        graphemeOffset: g,
        affinity: caretAffinity(g, record.graphemeCount),
      },
      role,
    });
  }
  return stops;
}

function whitespaceSubranges(text: string): readonly { readonly utf16From: number; readonly utf16To: number }[] {
  const out: { utf16From: number; utf16To: number }[] = [];
  const re = /\s+/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    out.push({ utf16From: match.index, utf16To: match.index + match[0].length });
  }
  return out;
}

function buildBlockRecords(
  storyId: string,
  located: readonly LocatedParagraph[],
  wordBoundary: WordBoundary,
): { records: BlockSemanticRecord[]; paragraphs: ParagraphRecord[] } {
  const paragraphs = located.map((l) => l.paragraph);
  const records = located.map(({ paragraph, context }, orderIndex) => {
    const text = paragraphText(paragraph);
    const readOnly = !paragraphEditableInLane(context);
    return {
      identity: identity(storyId, paragraph.id),
      orderIndex,
      graphemeCount: graphemeCount(text),
      utf16Length: text.length,
      empty: text.length === 0,
      readOnly,
      wordSegments: wordSegmentsToGraphemeRecords(text, segmentWords(text, wordBoundary)),
    };
  });
  return { records, paragraphs };
}

function paragraphRegions(
  scope: ViewScope,
  paragraphs: readonly ParagraphRecord[],
  records: readonly BlockSemanticRecord[],
): OwnershipRegion[] {
  const regions: OwnershipRegion[] = [];
  for (let i = 0; i < records.length; i += 1) {
    const record = records[i]!;
    const text = paragraphText(paragraphs[i]!);
    regions.push({
      scope,
      identity: record.identity,
      role: textRole(record.readOnly),
      kind: 'paragraph',
    });
    for (const sub of whitespaceSubranges(text)) {
      regions.push({
        scope,
        identity: record.identity,
        role: textRole(record.readOnly),
        kind: 'lineWhitespace',
        utf16From: sub.utf16From,
        utf16To: sub.utf16To,
        graphemeFrom: utf16OffsetToGrapheme(text, sub.utf16From),
        graphemeTo: utf16OffsetToGrapheme(text, sub.utf16To),
      });
    }
    if (!record.empty) {
      regions.push({
        scope,
        identity: record.identity,
        role: textRole(record.readOnly),
        kind: 'trailing',
      });
    }
  }
  return regions;
}

function structuralRegions(
  storyId: string,
  scope: ViewScope,
  blocks: readonly Block[],
): OwnershipRegion[] {
  const regions: OwnershipRegion[] = [];
  for (const block of flattenSdt(blocks)) {
    if (block.kind === 'table' && !isTopLevelEditable('table')) {
      regions.push({
        scope,
        identity: identity(storyId, block.id),
        role: 'selectableText',
        kind: 'structural',
      });
    }
  }
  return regions;
}

/** Build the canonical semantic index for the body story. */
export function buildSemanticIndex(
  model: PackageModel,
  scope: ViewScope = { kind: 'body' },
  wordBoundary: WordBoundary = resolveDefaultWordBoundary(),
): SemanticPositionIndex {
  const storyId = bodyStoryId(model);
  const story = model.stories.get(storyId)!;
  const located: LocatedParagraph[] = [];
  walkParagraphs(story.blocks, { inTopLevelBodyFlow: true, inTableCell: false }, located);

  const { records, paragraphs } = buildBlockRecords(storyId, located, wordBoundary);
  const storyIndex: StorySemanticIndex = { storyId, scope, blocks: records };
  const caretStops = records.flatMap((b) => caretStopsForParagraph(scope, b));
  const ownershipRegions = [
    ...paragraphRegions(scope, paragraphs, records),
    ...structuralRegions(storyId, scope, story.blocks),
  ];

  return { stories: [storyIndex], caretStops, ownershipRegions };
}

/** Deprecated flat view offsets derived from model semantic UTF-16 ranges, not painted items. */
export function deprecatedFlatDocOffset(
  index: SemanticPositionIndex,
  blockId: string,
  utf16From: number,
  utf16To: number,
): { docFrom: number; docTo: number; blockId: number } {
  const story = index.stories[0]!;
  let acc = 0;
  for (const block of story.blocks) {
    if (block.identity.blockId === blockId) {
      return { docFrom: acc + utf16From, docTo: acc + utf16To, blockId: block.orderIndex };
    }
    acc += block.utf16Length + 1;
  }
  return { docFrom: utf16From, docTo: utf16To, blockId: 0 };
}

export function semanticTextSpan(
  storyId: string,
  scope: ViewScope,
  paragraphId: string,
  paragraphFullText: string,
  utf16From: number,
  utf16To: number,
): SemanticTextSpan {
  return {
    scope,
    identity: identity(storyId, paragraphId),
    graphemeFrom: utf16OffsetToGrapheme(paragraphFullText, utf16From),
    graphemeTo: utf16OffsetToGrapheme(paragraphFullText, utf16To),
    utf16From,
    utf16To,
  };
}

/** Approximate one visual cluster per grapheme within a painted text slice. */
export function shapedClustersForSlice(
  semantic: SemanticTextSpan,
  itemBox: Rect,
  sliceText: string,
  paragraphGraphemeCount: number,
  direction: 'ltr' | 'rtl' = 'ltr',
): ShapedCluster[] {
  const segments = segmentGraphemes(sliceText);
  if (segments.length === 0) return [];
  const totalWidth = itemBox.width;
  const sliceGraphemeFrom = semantic.graphemeFrom;
  let x = itemBox.x;
  const widthPer = totalWidth / segments.length;
  return segments.map((seg, clusterIndex) => {
    const box: Rect = { x, y: itemBox.y, width: widthPer, height: itemBox.height };
    x += widthPer;
    const graphemeFrom = sliceGraphemeFrom + seg.index;
    const graphemeTo = graphemeFrom + 1;
    return {
      clusterIndex,
      graphemeFrom,
      graphemeTo,
      utf16From: semantic.utf16From + seg.utf16From,
      utf16To: semantic.utf16From + seg.utf16To,
      box,
      logicalOrder: direction === 'rtl' ? segments.length - 1 - clusterIndex : clusterIndex,
      direction,
      affinity: caretAffinity(graphemeFrom, paragraphGraphemeCount),
    };
  });
}

export function paragraphTextById(model: PackageModel, paragraphId: string): string {
  const storyId = bodyStoryId(model);
  const located: LocatedParagraph[] = [];
  walkParagraphs(model.stories.get(storyId)!.blocks, { inTopLevelBodyFlow: true, inTableCell: false }, located);
  const found = located.find((l) => l.paragraph.id === paragraphId);
  return found ? paragraphText(found.paragraph) : '';
}

export function paragraphGraphemeCountById(model: PackageModel, paragraphId: string): number {
  return graphemeCount(paragraphTextById(model, paragraphId));
}

export const twipsToPx = (twips: number): number => twips / 15;

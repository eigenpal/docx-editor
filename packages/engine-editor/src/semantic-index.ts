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
  SemanticTarget,
  SemanticTextSpan,
  StorySemanticIndex,
} from '@docx-editor.dev/core-contract/interaction';
import type { BlockTraversalLinks } from './navigation-geometry.ts';

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
  for (const block of blocks) {
    if (block.kind === 'sdt') {
      walkParagraphs((block as SdtRecord).blocks, { inTopLevelBodyFlow: false, inTableCell: context.inTableCell }, out);
      continue;
    }
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

/**
 * The single affinity the caret-stop index publishes for a grapheme offset.
 *
 * `caretStopsForParagraph` emits exactly one stop per offset using this rule, so
 * this function — not the caller's guess — decides which affinity is addressable.
 */
export function caretAffinity(graphemeOffset: number, paragraphGraphemeCount: number): InteractionAffinity {
  if (graphemeOffset >= paragraphGraphemeCount) return 'downstream';
  return graphemeOffset === 0 ? 'downstream' : 'upstream';
}

/**
 * Re-stamp an observed text target with the canonical affinity for its offset.
 *
 * The edit surface captures a selection as `(paragraph semId, offset, affinity)`
 * with affinity hardcoded to `'after'` — it projects ProseMirror state and has no
 * line geometry, so it cannot know which side of a wrap the caret sits on. That
 * maps to `'downstream'` for every offset, while `caretAffinity` makes `upstream`
 * canonical for every interior offset.
 *
 * Independent review measured the consequence: after any keystroke or relayout the
 * reconciled selection was published as `downstream`, `caretStops` at that offset
 * held only `upstream`, and the caret-rect lookup requires an exact match — so
 * `frame.caret` was null, no caret element existed in the DOM, and Home, End,
 * PageUp, PageDown, ArrowUp and ArrowDown were all refused with `invalidTarget`
 * ("requires a line-resolved caret" / "could not be seeded from caret geometry").
 * Because the adapter bridge swallows geometry keys in capture phase, they were
 * dead keys rather than falling through. Both adapters, primary editing loop.
 *
 * Normalizing here keeps one authority for affinity: the index that publishes the
 * stops. Non-text targets pass through unchanged.
 */
export function withCanonicalAffinity(
  target: SemanticTarget,
  graphemeCountOf: (blockId: string) => number | undefined,
): SemanticTarget {
  if (target.kind !== 'text') return target;
  const count = graphemeCountOf(target.identity.blockId);
  if (count === undefined) return target;
  const canonical = caretAffinity(target.graphemeOffset, count);
  return canonical === target.affinity ? target : { ...target, affinity: canonical };
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

/** Top-level editable paragraph adjacency links for keyboard navigation (task 5.5). */
export function buildTraversalLinks(
  storyBlocks: readonly Block[],
  records: readonly BlockSemanticRecord[],
): Map<string, BlockTraversalLinks> {
  const byId = new Map(records.map((record) => [record.identity.blockId, record]));
  const links = new Map<string, BlockTraversalLinks>(
    records.map((record) => [record.identity.blockId, { previousEditableBlockId: null, nextEditableBlockId: null }]),
  );
  let lastEditable: string | null = null;
  for (const block of storyBlocks) {
    if (block.kind !== 'paragraph') {
      lastEditable = null;
      continue;
    }
    const record = byId.get(block.id);
    if (!record || record.readOnly) {
      lastEditable = null;
      continue;
    }
    if (lastEditable) {
      const prevLinks = links.get(lastEditable)!;
      links.set(lastEditable, { ...prevLinks, nextEditableBlockId: record.identity.blockId });
      const nextLinks = links.get(record.identity.blockId)!;
      links.set(record.identity.blockId, { ...nextLinks, previousEditableBlockId: lastEditable });
    }
    lastEditable = record.identity.blockId;
  }
  return links;
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

export function buildTraversalLinksForModel(
  model: PackageModel,
  wordBoundary: WordBoundary = resolveDefaultWordBoundary(),
): Map<string, BlockTraversalLinks> {
  const storyId = bodyStoryId(model);
  const story = model.stories.get(storyId)!;
  const located: LocatedParagraph[] = [];
  walkParagraphs(story.blocks, { inTopLevelBodyFlow: true, inTableCell: false }, located);
  const { records } = buildBlockRecords(storyId, located, wordBoundary);
  return buildTraversalLinks(story.blocks, records);
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

/**
 * Paragraph text by id, indexed once per (model, story).
 *
 * This walked the ENTIRE story and re-joined every run on every call, and
 * `toDisplayPages` calls it once per text item AND once per caret edge — i.e. once
 * per character. That made publishing a display list quadratic in document size,
 * independently of anything in `layoutBody`.
 *
 * Independent review measured it on ORDINARY documents, no crafted markup: plain
 * sentences, one run per paragraph, realistic zip ratio.
 *
 *   500 paragraphs  (6 KB, 10 pages)  createEditor()   1.72 s
 *   1,000           (11 KB, 19 pages)                  8.27 s
 *   2,000           (20 KB, 38 pages)                 23.5 s
 *   4,000           (38 KB, 75 pages)                120.7 s
 *   8,000           (75 KB, 149 pages)               534 s  (8.9 min)
 *
 * A 75-page Word document froze the main thread for two minutes on open and again
 * on every keystroke. Four prior rounds hunted this in `layoutBody`, where it never
 * was; the cost guards added for it instrument `layoutBody` and therefore read
 * perfectly linear on inputs that freeze the product for 20+ seconds.
 *
 * Keyed on the model, which is immutable — `store.apply` produces a new one — so a
 * commit naturally invalidates the index rather than needing explicit eviction. A
 * WeakMap keeps it collectable with the model.
 */
const paragraphTextIndex = new WeakMap<PackageModel, Map<string, Map<string, string>>>();

function paragraphTextsForStory(model: PackageModel, storyId: string): Map<string, string> {
  let perStory = paragraphTextIndex.get(model);
  if (!perStory) {
    perStory = new Map();
    paragraphTextIndex.set(model, perStory);
  }
  const cached = perStory.get(storyId);
  if (cached) return cached;

  const texts = new Map<string, string>();
  const story = model.stories.get(storyId);
  if (story) {
    const located: LocatedParagraph[] = [];
    walkParagraphs(
      story.blocks,
      { inTopLevelBodyFlow: storyId === bodyStoryId(model), inTableCell: storyId !== bodyStoryId(model) },
      located,
    );
    for (const l of located) texts.set(l.paragraph.id, paragraphText(l.paragraph));
  }
  perStory.set(storyId, texts);
  return texts;
}

export function paragraphTextById(model: PackageModel, paragraphId: string, storyId = bodyStoryId(model)): string {
  return paragraphTextsForStory(model, storyId).get(paragraphId) ?? '';
}

/** Grapheme count by paragraph id, memoized alongside the text for the same reason. */
const paragraphGraphemeCounts = new WeakMap<PackageModel, Map<string, number>>();

export function paragraphGraphemeCountById(model: PackageModel, paragraphId: string): number {
  let counts = paragraphGraphemeCounts.get(model);
  if (!counts) {
    counts = new Map();
    paragraphGraphemeCounts.set(model, counts);
  }
  const cached = counts.get(paragraphId);
  if (cached !== undefined) return cached;
  const value = graphemeCount(paragraphTextById(model, paragraphId));
  counts.set(paragraphId, value);
  return value;
}

export const twipsToPx = (twips: number): number => twips / 15;

// Which paragraphs a hidden paragraph mark removes from the laid-out flow.
//
// `w:vanish` in the paragraph mark's run properties (17.3.1.29 `w:pPr/w:rPr`, 17.3.2.41) hides
// the mark itself, and `w:specVanish` (17.3.2.36) hides it even where hidden text is shown.
// A hidden mark draws no break: the paragraph runs into the one after it. When the paragraph
// shows nothing else either, that join leaves nothing on the page — no line box, and no
// spacing before or after. Laying such a paragraph out as an ordinary empty line put a full
// line of blank space, plus its spacing, wherever a document hides empty paragraphs.
//
// The condition is narrow on purpose, like the revision rule in `revision-visibility.ts`:
//
//   - The mark must be hidden by DIRECT formatting. Direct formatting decides a toggle
//     outright, so no style cascade is needed; a mark hidden through a style keeps its line.
//   - The paragraph must render nothing visible. A hidden mark after visible text merges that
//     text forward, and dropping the box would lose it, so such a paragraph keeps its box.
//   - A paragraph or table must follow in the same container. The last paragraph of a story,
//     cell, or content control keeps its line. Before a table the paragraph's own space before
//     still applies, so one that states a space before keeps its line there. An automatic space
//     before alone (`w:beforeAutospacing` without a measurement) states none.
//   - A paragraph carrying `w:sectPr` keeps its box, so section boundaries do not move.
//
// A paragraph inside a field instruction leaves the flow under the same conditions, whatever
// it holds, because its mark is field code (see `field-instruction-paragraphs.ts`).
//
// A paragraph with a hidden mark stays in the tree and still advances list counters: numbering
// is a property of the document, not of what the page shows. {@link numberingFlowBlocks} gives
// the block list with removed paragraphs put back. A paragraph inside a field instruction is
// field code, not document content, so it advances no counter: {@link listCountingBlocks}
// leaves it out.
//
// It also stays the neighbour that `w:contextualSpacing` (17.3.1.9) compares against. A
// paragraph after a removed run keeps or drops its space before by the style of the removed
// paragraph next to it, not by the visible paragraph beyond the run; the same holds for the
// space after of the paragraph before the run. The removed paragraph adds no spacing itself.
// {@link hiddenMarkNeighboursOf} carries those neighbours on the kept paragraphs.

import type { OoxmlElement, OoxmlNode } from '@docx-editor.dev/core/store';
import { readOnOffChild } from '../store/package/ooxml-shared.ts';
import { WML_NAMESPACE_URI } from '../store/package/ooxml-tree.ts';
import {
  scanFieldInstructionParagraphs,
  type FieldCodeJoin,
} from './field-instruction-paragraphs.ts';
import type { RevisionAuthorFilter, RevisionDisplayMode } from './revision-projection.ts';
import { paragraphRendersNothingVisible } from './revision-visibility.ts';

/** A block, and the node id of the children array it lives in. */
export interface HiddenMarkFlowEntry {
  readonly block: OoxmlElement;
  readonly parentKey: string;
}

function wmlChild(node: OoxmlNode, localName: string): OoxmlElement | undefined {
  if (node.kind === 'textValue') return undefined;
  for (const child of node.children) {
    if (child.kind === 'textValue') continue;
    if (child.namespaceUri === WML_NAMESPACE_URI && child.localName === localName) return child;
  }
  return undefined;
}

/**
 * Per immutable paragraph node. Every story-block enumeration asks this of every paragraph, and
 * a keystroke replaces only the edited one, so the rest answer from here.
 */
const markHiddenByParagraph = new WeakMap<OoxmlNode, boolean>();

/** `w:pPr/w:rPr` sets `w:vanish` or `w:specVanish` on. */
export function paragraphMarkHidden(paragraph: OoxmlNode): boolean {
  const cached = markHiddenByParagraph.get(paragraph);
  if (cached !== undefined) return cached;
  const properties = wmlChild(paragraph, 'pPr');
  const markRunProperties = properties && wmlChild(properties, 'rPr');
  const hidden =
    markRunProperties !== undefined &&
    (readOnOffChild(markRunProperties, 'vanish') ||
      readOnOffChild(markRunProperties, 'specVanish'));
  markHiddenByParagraph.set(paragraph, hidden);
  return hidden;
}

/**
 * Whether the paragraph states a space before directly. Before a table, a removed paragraph
 * still keeps its space before; leaving it in place keeps that space, so only paragraphs
 * without one leave the flow there. `w:beforeAutospacing` alone states no measurement: such a
 * paragraph leaves the flow too, with or without `w:doNotUseHTMLParagraphAutoSpacing`.
 */
function directSpaceBefore(paragraph: OoxmlNode): boolean {
  const properties = wmlChild(paragraph, 'pPr');
  const spacing = properties && wmlChild(properties, 'spacing');
  if (!spacing) return false;
  const value = (name: string): string | undefined =>
    spacing.attributes.find((attribute) => attribute.localName === name)?.value;
  return Number(value('before') ?? 0) > 0 || Number(value('beforeLines') ?? 0) > 0;
}

function carriesSectionBreak(paragraph: OoxmlNode): boolean {
  const properties = wmlChild(paragraph, 'pPr');
  return properties !== undefined && wmlChild(properties, 'sectPr') !== undefined;
}

/** The removed paragraphs directly beside a kept one. */
export interface HiddenMarkNeighbours {
  /** The removed paragraph directly before, the last of its run. */
  readonly before?: OoxmlElement;
  /** The removed paragraph directly after, the first of its run. */
  readonly after?: OoxmlElement;
}

/** Laid-out block list → the same list with the removed paragraphs back in document order. */
const numberingFlows = new WeakMap<readonly OoxmlElement[], readonly OoxmlElement[]>();
/** Ids of the paragraphs between a field's `begin` and the end of its field codes. */
const fieldCodeSpans = new WeakMap<readonly OoxmlElement[], ReadonlySet<string>>();

/**
 * True when the paragraph `id` sits inside the field codes of a field that spans paragraphs in
 * `blocks`, a list {@link withoutHiddenMarkParagraphs} returned. Its text decides whether the
 * field's other paragraphs leave the flow, so an edit to it needs a full pass.
 */
export function insideFieldCodeSpan(blocks: readonly OoxmlElement[], id: string): boolean {
  return fieldCodeSpans.get(blocks)?.has(id) ?? false;
}

/** The numbering flow without the removed field-code paragraphs, when there are any. */
const listCountingFlows = new WeakMap<readonly OoxmlElement[], readonly OoxmlElement[]>();

/** A kept paragraph's stand-in → the removed paragraphs beside it. */
const neighboursOfStandIn = new WeakMap<OoxmlElement, HiddenMarkNeighbours>();

/** A kept paragraph → its current stand-in, reused while its neighbours stay the same nodes. */
const standIns = new WeakMap<
  OoxmlElement,
  { readonly neighbours: HiddenMarkNeighbours; readonly standIn: OoxmlElement }
>();

/**
 * The removed paragraphs beside this laid-out paragraph, if any.
 *
 * Only the blocks {@link withoutHiddenMarkParagraphs} returns carry them.
 */
export function hiddenMarkNeighboursOf(block: OoxmlElement): HiddenMarkNeighbours | undefined {
  return neighboursOfStandIn.get(block);
}

/**
 * The kept paragraph as a shallow copy that remembers its removed neighbours.
 *
 * A copy, not the tree node, so the block's IDENTITY changes exactly when its neighbours do:
 * incremental layout reuses prepared blocks and section prepasses by identity, and a
 * neighbour deleted from the tree changes this paragraph's spacing without changing the
 * paragraph. Memoized, so an unrelated edit keeps the same copy.
 */
function standInFor(block: OoxmlElement, neighbours: HiddenMarkNeighbours): OoxmlElement {
  const cached = standIns.get(block);
  if (
    cached &&
    cached.neighbours.before === neighbours.before &&
    cached.neighbours.after === neighbours.after
  ) {
    return cached.standIn;
  }
  const standIn = { ...block } as OoxmlElement;
  neighboursOfStandIn.set(standIn, neighbours);
  standIns.set(block, { neighbours, standIn });
  return standIn;
}

/**
 * The blocks that lay out, without the paragraphs a hidden mark removes.
 *
 * Walks backwards so a run of such paragraphs all find the paragraph that finally takes the
 * join. Returns the entries' blocks unchanged in the common case of no hidden marks.
 *
 * `canStandIn` refuses a copy for a block whose identity something else is keyed on; that
 * block keeps its own neighbours for contextual spacing.
 *
 * `mergeFieldCodes` lays the paragraph that opens a field and the paragraph where its field
 * codes end out as one, when only field-code paragraphs stand between them (see
 * `field-code-paragraph-merge.ts`). The numbering flow keeps both paragraphs.
 */
export function withoutHiddenMarkParagraphs(
  entries: readonly HiddenMarkFlowEntry[],
  displayMode: RevisionDisplayMode,
  authorFilter?: RevisionAuthorFilter,
  canStandIn: (block: OoxmlElement) => boolean = () => true,
  mergeFieldCodes?: (first: OoxmlElement, last: OoxmlElement) => OoxmlElement | null
): OoxmlElement[] {
  let removed: Set<number> | null = null;
  let next: HiddenMarkFlowEntry | undefined;
  const fieldCodes = scanFieldInstructionParagraphs(entries.map((entry) => entry.block));
  const insideInstructions = fieldCodes.inside;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]!;
    const { block } = entry;
    // A field-code paragraph leaves the flow whatever follows it, also at the end of a content
    // control: the field's last paragraph always comes after it. A hidden mark joins the next
    // block, so it needs one in its own container.
    const leaves =
      next !== undefined &&
      (insideInstructions.has(index) ||
        (next.parentKey === entry.parentKey &&
          (next.block.kind === 'paragraph' ||
            (next.block.kind === 'table' && !directSpaceBefore(block))) &&
          paragraphMarkHidden(block) &&
          paragraphRendersNothingVisible(block, displayMode, authorFilter)));
    if (block.kind === 'paragraph' && leaves && !carriesSectionBreak(block)) {
      (removed ??= new Set()).add(index);
      continue;
    }
    next = entry;
  }
  const merges = fieldCodeMerges(entries, fieldCodes.joins, removed, canStandIn, mergeFieldCodes);
  const spannedIds = (): ReadonlySet<string> =>
    new Set([...fieldCodes.spanned].map((index) => entries[index]!.block.id));
  const joinFirsts = new Set(fieldCodes.joins.map((join) => join.first));
  if (removed === null && merges.size === 0 && insideInstructions.size + joinFirsts.size === 0) {
    const blocks = entries.map((entry) => entry.block);
    if (fieldCodes.spanned.size > 0) fieldCodeSpans.set(blocks, spannedIds());
    return blocks;
  }
  const removedIndexes = removed ?? new Set<number>();
  // A removed paragraph is a neighbour only inside its own container, the same rule that
  // decided the removal.
  const removedBeside = (index: number, side: -1 | 1): OoxmlElement | undefined => {
    const other = entries[index + side];
    return other &&
      removedIndexes.has(index + side) &&
      other.parentKey === entries[index]!.parentKey
      ? other.block
      : undefined;
  };
  const all = entries.map((entry, index) => {
    const { block } = entry;
    if (removedIndexes.has(index) || block.kind !== 'paragraph' || !canStandIn(block)) return block;
    if (merges.has(index) || merges.absorbed.has(index)) return block;
    const before = removedBeside(index, -1);
    const after = removedBeside(index, 1);
    if (!before && !after) return block;
    return standInFor(block, { ...(before ? { before } : {}), ...(after ? { after } : {}) });
  });
  const kept = all.flatMap((block, index) => {
    if (removedIndexes.has(index) || merges.absorbed.has(index)) return [];
    return [merges.get(index) ?? block];
  });
  numberingFlows.set(kept, all);
  if (fieldCodes.spanned.size > 0) fieldCodeSpans.set(kept, spannedIds());
  // A field-code paragraph counts nothing: one wholly inside the field codes, and one whose
  // mark the field codes cover because it holds the field's `begin`. The same rule applies in
  // table cells (`fieldCodeMarkParagraphs`), whether the paragraph leaves the flow or not.
  const fieldCode = (index: number) => insideInstructions.has(index) || joinFirsts.has(index);
  if (all.some((_block, index) => fieldCode(index))) {
    listCountingFlows.set(
      kept,
      all.filter((_block, index) => !fieldCode(index))
    );
  }
  return kept;
}

/** Merged paragraphs by the index of the paragraph that opens the field, and the absorbed ones. */
type FieldCodeMerges = Map<number, OoxmlElement> & { readonly absorbed: ReadonlySet<number> };

/**
 * The field-code joins that apply: both ends are kept paragraphs in one container, neither
 * carries a section break or stands for other paragraphs already, and every block between
 * them left the flow.
 */
function fieldCodeMerges(
  entries: readonly HiddenMarkFlowEntry[],
  joins: readonly FieldCodeJoin[],
  removed: ReadonlySet<number> | null,
  canStandIn: (block: OoxmlElement) => boolean,
  mergeFieldCodes: ((first: OoxmlElement, last: OoxmlElement) => OoxmlElement | null) | undefined
): FieldCodeMerges {
  const absorbed = new Set<number>();
  const merges = Object.assign(new Map<number, OoxmlElement>(), { absorbed });
  if (!mergeFieldCodes) return merges;
  for (const { first, last } of joins) {
    const opening = entries[first];
    const closing = entries[last];
    if (!opening || !closing || opening.parentKey !== closing.parentKey) continue;
    if (merges.has(first) || absorbed.has(first) || merges.has(last)) continue;
    const ends = [opening.block, closing.block];
    if (ends.some((block) => block.kind !== 'paragraph' || !canStandIn(block))) continue;
    if (ends.some(carriesSectionBreak) || removed?.has(first) || removed?.has(last)) continue;
    // Between them, a content control can wrap field-code paragraphs; they left the flow too.
    let between = true;
    for (let index = first + 1; index < last && between; index += 1) {
      between = removed?.has(index) === true;
    }
    if (!between) continue;
    const merged = mergeFieldCodes(opening.block, closing.block);
    if (!merged) continue;
    merges.set(first, merged);
    absorbed.add(last);
  }
  return merges;
}

/**
 * The block list that list numbering walks: `blocks` with every paragraph a hidden mark removed
 * from the flow put back, in document order.
 *
 * Returns `blocks` itself when nothing was removed, so the list memos keyed on its identity
 * keep hitting.
 */
export function numberingFlowBlocks(blocks: readonly OoxmlElement[]): readonly OoxmlElement[] {
  return numberingFlows.get(blocks) ?? blocks;
}

/**
 * The block list that list counters walk: {@link numberingFlowBlocks} without the paragraphs a
 * field instruction removed. Their marks are field code, so their list items count nothing.
 *
 * Returns the numbering flow itself when no such paragraph was removed, so list memos keyed on
 * its identity keep hitting.
 */
export function listCountingBlocks(blocks: readonly OoxmlElement[]): readonly OoxmlElement[] {
  return listCountingFlows.get(blocks) ?? numberingFlowBlocks(blocks);
}

/**
 * Give `to`, a copy of `from` with some blocks swapped (see `replaced`), the numbering list of
 * `from` with the same blocks swapped, so the paragraphs a hidden mark removed stay counted.
 */
export function carryNumberingFlow(
  from: readonly OoxmlElement[],
  to: readonly OoxmlElement[],
  replaced: ReadonlyMap<OoxmlElement, OoxmlElement>
): void {
  const flow = numberingFlows.get(from);
  if (flow)
    numberingFlows.set(
      to,
      flow.map((block) => replaced.get(block) ?? block)
    );
  const spans = fieldCodeSpans.get(from);
  if (spans) fieldCodeSpans.set(to, spans);
  const counting = listCountingFlows.get(from);
  if (counting)
    listCountingFlows.set(
      to,
      counting.map((block) => replaced.get(block) ?? block)
    );
}

import { FieldResultsModeMemo } from '../store/package/field-result-mode.ts';
import { fnv1a64Hex } from '../store/comparators/canonical.ts';
import { framedTokenJoin } from './layout-cache.ts';
import type { OoxmlElement, OoxmlNode, OoxmlPart } from '../store/package/ooxml-tree.ts';
import { findNode } from '../store/package/ooxml-edit.ts';
import {
  fldCharType,
  fldSimpleInstr,
  instrTextValue,
  isFldSimple,
  isInstrText,
} from '../store/package/field-nodes.ts';
import {
  MAX_INLINE_CONTAINER_DEPTH,
  nextInlineContainerDepth,
} from '../store/package/ooxml-shared.ts';
import { detectBodyTocs, tocFieldRange } from '../store/package/toc-detect.ts';
import {
  paragraphOffsetIndex,
  type ParagraphOffsetIndex,
} from '../store/store/tree-op-segments.ts';
import type { RunPropertyCascader } from './field-run-text.ts';
import type { StyleCascadeTable } from './style-cascade.ts';
import { styleSeparatorRanges } from './style-separator-group.ts';

/** Link content in a TOC result, which drops the Hyperlink character style. */
export interface TocLinkRange {
  readonly start: number;
  readonly end: number;
  /**
   * The `w:styleId` values of the character styles whose `w:name` is Hyperlink, resolved from
   * the style definitions (`w:style`). At most four ids.
   */
  readonly styleIds: readonly string[];
}
export type TocLinkRanges = ReadonlyMap<string, readonly TocLinkRange[]>;
const NO_RANGES: TocLinkRanges = new Map();
/** Offsets differ between field-result modes, so each mode keeps its own entry. */
const cache = new FieldResultsModeMemo<
  OoxmlPart,
  { readonly styles: StyleCascadeTable; readonly ranges: TocLinkRanges }
>();
const hyperlinkIds = new WeakMap<StyleCascadeTable, readonly string[]>();
/**
 * `w:name` values need not be unique, but a real file names one style Hyperlink. Every range and
 * the layout digests repeat the list, so a crafted file with many such styles stays bounded.
 */
const MAX_HYPERLINK_STYLE_IDS = 4;

/**
 * The `w:styleId` values of the character styles (`w:style` `w:type="character"`) that are the
 * Hyperlink style. The style is known by its `w:name`; its `w:styleId` can be localized or
 * numeric. Only a definition without `w:name` falls back to the id. A style with the
 * `w:styleId` `Hyperlink` and another `w:name` is an ordinary style here, although link
 * insertion prefers that id when it picks a style to apply. At most
 * {@link MAX_HYPERLINK_STYLE_IDS} such styles count: the id `Hyperlink` first, then document order.
 *
 * Known limits: a link style under another name, such as "Internet Link", is not matched. In a
 * file whose `Hyperlink` id has another name, a link inserted in a TOC row keeps that style.
 */
function hyperlinkStyleIds(styles: StyleCascadeTable): readonly string[] {
  const held = hyperlinkIds.get(styles);
  if (held) return held;
  const isHyperlink = (id: string) => {
    const definition = styles.styles.get(id);
    return (
      definition?.type === 'character' && (definition.name ?? id).toLowerCase() === 'hyperlink'
    );
  };
  // The usual id comes first, so decoy styles earlier in the file cannot push it out.
  const ids: string[] = isHyperlink('Hyperlink') ? ['Hyperlink'] : [];
  for (const id of styles.styles.keys()) {
    if (ids.length >= MAX_HYPERLINK_STYLE_IDS) break;
    if (id !== 'Hyperlink' && isHyperlink(id)) ids.push(id);
  }
  hyperlinkIds.set(styles, ids);
  return ids;
}

/**
 * Complex fields (`w:fldChar`) open at a paragraph boundary. Only the outermost {@link MAX_TRACKED_FIELDS}
 * keep their instruction; deeper ones are only counted, so a crafted nesting stays bounded.
 */
interface OpenFields {
  readonly instructions: readonly string[];
  readonly untracked: number;
}
const NO_OPEN_FIELDS: OpenFields = { instructions: [], untracked: 0 };
/** More than any real nesting of fields around a TOC link. A deeper link keeps the style. */
const MAX_TRACKED_FIELDS = 8;

interface ParagraphLinks {
  readonly spans: readonly { readonly start: number; readonly end: number }[];
  /** Fields still open at the paragraph end. Each `end` in the next paragraph closes its own. */
  readonly openAtEnd: OpenFields;
}
interface HeldParagraphLinks extends ParagraphLinks {
  readonly openAtStart: OpenFields;
}
/** Paragraphs are immutable, so an unchanged TOC row keeps its link spans across edits. */
const linkSpanCache = new FieldResultsModeMemo<OoxmlNode, HeldParagraphLinks>();
/** Enough of an instruction to read its field type; the rest is never needed here. */
const LINK_INSTRUCTION_PREFIX = 32;

function isHyperlinkInstruction(instruction: string): boolean {
  return /^\s*HYPERLINK(?![A-Za-z])/i.test(instruction);
}

function sameOpenFields(a: OpenFields, b: OpenFields): boolean {
  return (
    a.untracked === b.untracked &&
    a.instructions.length === b.instructions.length &&
    a.instructions.every((instruction, index) => instruction === b.instructions[index])
  );
}

/**
 * Where a paragraph holds link content: `w:hyperlink` elements, `w:fldSimple` fields with a
 * `HYPERLINK` instruction, and complex `HYPERLINK` fields from `w:fldChar` `begin` to their own
 * `end`. The spans come from the paragraph
 * offset index, so an atomic field contributes its single unit. Fields still open at the end
 * of the previous paragraph start at offset 0, so a link that crosses a paragraph mark covers
 * the rest of its first paragraph and the start of the next, also with a nested field.
 */
function linkSpansOf(
  paragraph: OoxmlNode,
  offsets: ParagraphOffsetIndex,
  openAtStart: OpenFields
): ParagraphLinks {
  const held = linkSpanCache.get(paragraph);
  if (held && sameOpenFields(held.openAtStart, openAtStart)) return held;
  const spans: { start: number; end: number }[] = [];
  const add = (start: number | undefined, end: number | undefined) => {
    if (start !== undefined && end !== undefined && end > start) spans.push({ start, end });
  };
  const fields: { instruction: string; start?: number }[] = openAtStart.instructions.map(
    (instruction) => ({ instruction, start: 0 })
  );
  let untracked = openAtStart.untracked;
  const visit = (node: OoxmlNode, depth: number): void => {
    if (node.kind === 'textValue' || depth >= MAX_INLINE_CONTAINER_DEPTH) return;
    if (node.kind === 'hyperlink') {
      const span = offsets.spanOf(node);
      add(span?.start, span?.end);
    } else if (isFldSimple(node)) {
      if (isHyperlinkInstruction(fldSimpleInstr(node) ?? '')) {
        const span = offsets.spanOf(node);
        add(span?.start, span?.end);
      }
      return;
    }
    const type = fldCharType(node);
    if (type === 'begin') {
      if (untracked > 0 || fields.length >= MAX_TRACKED_FIELDS) untracked += 1;
      else fields.push({ instruction: '', start: offsets.spanOf(node)?.start });
    } else if (type === 'end') {
      // The innermost open field owns this `w:fldChar` `end`, whatever its type.
      if (untracked > 0) untracked -= 1;
      else {
        const field = fields.pop();
        if (field && isHyperlinkInstruction(field.instruction)) {
          add(field.start, offsets.spanOf(node)?.end);
        }
      }
    } else if (isInstrText(node) && untracked === 0) {
      const field = fields.at(-1);
      if (field && field.instruction.length < LINK_INSTRUCTION_PREFIX) {
        field.instruction += instrTextValue(node).slice(0, LINK_INSTRUCTION_PREFIX);
      }
    }
    // Depth counts inline containers, as the offset index and TOC detection do.
    const next = nextInlineContainerDepth(node, depth);
    for (const child of node.children) visit(child, next);
  };
  visit(paragraph, 0);
  const openLink = fields.find((field) => isHyperlinkInstruction(field.instruction));
  if (openLink) add(openLink.start ?? 0, offsets.length);
  const openAtEnd =
    fields.length === 0 && untracked === 0
      ? NO_OPEN_FIELDS
      : { instructions: fields.map((field) => field.instruction), untracked };
  const links = { spans, openAtEnd, openAtStart };
  linkSpanCache.set(paragraph, links);
  return links;
}

/**
 * The parts of `TOC` field results that drop the Hyperlink character style: link content inside
 * the cached result. Text outside a link keeps the style, whatever the `TOC \h` switch says.
 *
 * Exception: a TOC whose `w:fldChar` `begin` and `end` are in one paragraph is a single atomic unit in the
 * offset index. Its result has no offsets of its own, so the whole unit drops the style. Text
 * outside a link in such a TOC loses the Hyperlink style too.
 */
export function tocLinkRanges(
  part: OoxmlPart,
  styles: StyleCascadeTable | undefined
): TocLinkRanges {
  const styleIds = styles ? hyperlinkStyleIds(styles) : [];
  if (!styles || styleIds.length === 0) return NO_RANGES;
  const held = cache.get(part);
  if (held?.styles === styles) return held.ranges;
  const ranges = new Map<string, TocLinkRange[]>();
  for (const toc of detectBodyTocs(part)) {
    const field = tocFieldRange(toc);
    if (!field) continue;
    let openFields = NO_OPEN_FIELDS;
    for (const id of new Set([
      field.separateParagraphId,
      ...toc.resultParagraphIds,
      toc.endParagraphId,
    ])) {
      const paragraph = findNode(part, id);
      if (paragraph?.kind !== 'paragraph') continue;
      const offsets = paragraphOffsetIndex(paragraph);
      const links = linkSpansOf(paragraph, offsets, openFields);
      openFields = links.openAtEnd;
      const atom =
        toc.beginParagraphId === toc.endParagraphId ? offsets.spanOf(toc.beginNodeId) : undefined;
      const start =
        atom?.start ??
        (id === field.separateParagraphId ? offsets.spanOf(field.separateNodeId)?.end : 0);
      const end =
        atom?.end ??
        (id === toc.endParagraphId ? offsets.spanOf(field.endNodeId)?.start : offsets.length);
      if (start === undefined || end === undefined || end <= start) continue;
      // A one-paragraph TOC is a single atomic unit, so the whole unit takes one answer.
      const linked = atom
        ? [{ start, end, styleIds }]
        : links.spans.flatMap((link) =>
            link.end > start && link.start < end
              ? [{ start: Math.max(start, link.start), end: Math.min(end, link.end), styleIds }]
              : []
          );
      if (linked.length === 0) continue;
      const list = ranges.get(id) ?? [];
      list.push(...linked);
      ranges.set(id, list);
    }
  }
  for (const [id, list] of ranges) ranges.set(id, mergedRanges(list));
  cache.set(part, { styles, ranges });
  return ranges;
}

/**
 * Sorted, with overlapping and touching ranges joined: a `w:hyperlink` inside a `HYPERLINK`
 * field overlaps, and adjacent links touch. The cascader can then search the list.
 */
function mergedRanges(list: readonly TocLinkRange[]): TocLinkRange[] {
  const sorted = [...list].sort((a, b) => a.start - b.start);
  const merged: TocLinkRange[] = [];
  for (const range of sorted) {
    const last = merged.at(-1);
    if (last && range.start <= last.end) {
      merged[merged.length - 1] = { ...last, end: Math.max(last.end, range.end) };
    } else merged.push(range);
  }
  return merged;
}

/** The range that holds `at`, by binary search over sorted, disjoint ranges. */
function rangeAt(ranges: readonly TocLinkRange[], at: number): TocLinkRange | undefined {
  let low = 0;
  let high = ranges.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const range = ranges[middle]!;
    if (at < range.start) high = middle - 1;
    else if (at >= range.end) low = middle + 1;
    else return range;
  }
  return undefined;
}

/**
 * Drop the `w:rStyle` reference to the Hyperlink character style from direct run properties
 * (`w:rPr`) inside the given ranges.
 * Each range carries the style ids to drop, so any cascader gets the same result. Only a direct
 * reference is dropped: a character style based on Hyperlink keeps all its formatting.
 */
export function tocLinkCascader(
  cascade: RunPropertyCascader | undefined,
  ranges: readonly TocLinkRange[] | undefined,
  position: () => number
): RunPropertyCascader | undefined {
  if (!cascade || !ranges?.length) return cascade;
  return (inherited, direct) => {
    const at = position();
    const range = rangeAt(ranges, at);
    if (!range) return cascade(inherited, direct);
    return cascade(
      inherited,
      direct.filter(
        (p) => p.localName !== 'rStyle' || !range.styleIds.includes(p.attributes?.val ?? '')
      )
    );
  };
}

/**
 * One paragraph's TOC link ranges, the accessor that body paint, table-cell paint, and autofit
 * column widths (`w:tblLayout` `autofit`) share. A style-separator group reads its members' ranges at their offsets.
 *
 * TOC detection does not enter table cells yet, so a cell paragraph gets no ranges today. The
 * cell paint and autofit width reads are a guard: when cell TOC detection lands, they apply the rule
 * without more changes.
 */
export function tocLinkRangesOf(
  paragraph: OoxmlElement,
  ranges: TocLinkRanges | undefined
): readonly TocLinkRange[] | undefined {
  return styleSeparatorRanges(paragraph, ranges);
}

const tokens = new WeakMap<TocLinkRanges, string>();
/** Cross-paragraph field membership can change while a cached result paragraph stays identical. */
export function tocLinkStyleToken(ranges: TocLinkRanges): string {
  if (ranges.size === 0) return '';
  const held = tokens.get(ranges);
  if (held !== undefined) return held;
  // A layout-cache token, never persisted: hash a length-framed join rather than canonicalizing
  // a copy of every range. Length framing stays injective whatever characters an id carries.
  const parts: string[] = [];
  // Each range's style ids (at most four) are in the token: a renamed style changes them.
  for (const [paragraphId, list] of ranges) {
    parts.push(paragraphId, list.map((range) => `${range.start},${range.end}`).join(';'));
    for (const range of list) parts.push(String(range.styleIds.length), ...range.styleIds);
  }
  const token = fnv1a64Hex(framedTokenJoin(parts));
  tokens.set(ranges, token);
  return token;
}

import { FieldResultsModeMemo } from '../store/package/field-result-mode.ts';
import { fnv1a64Hex } from '../store/comparators/canonical.ts';
import { framedTokenJoin } from './layout-cache.ts';
import type { OoxmlNode, OoxmlPart } from '../store/package/ooxml-tree.ts';
import type { OoxmlProperty } from '../store/store/tree-op-types.ts';
import { findNode } from '../store/package/ooxml-edit.ts';
import {
  fldCharType,
  fldSimpleInstr,
  instrTextValue,
  isFldSimple,
  isInstrText,
} from '../store/package/field-nodes.ts';
import { MAX_INLINE_CONTAINER_DEPTH } from '../store/package/ooxml-shared.ts';
import { detectBodyTocs, tocFieldRange } from '../store/package/toc-detect.ts';
import {
  paragraphOffsetIndex,
  type ParagraphOffsetIndex,
} from '../store/store/tree-op-segments.ts';
import type { RunPropertyCascader } from './field-run-text.ts';
import { cascadeRunProperties, type StyleCascadeTable } from './style-cascade.ts';

export interface TocLinkRange {
  readonly start: number;
  readonly end: number;
}
export type TocLinkRanges = ReadonlyMap<string, readonly TocLinkRange[]>;
/** Offsets differ between field-result modes, so each mode keeps its own entry. */
const cache = new FieldResultsModeMemo<OoxmlPart, TocLinkRanges>();

interface ParagraphLinks {
  readonly spans: readonly TocLinkRange[];
  /**
   * The instructions of complex fields still open at the paragraph end, outermost first. They
   * continue in the next paragraph, so each `end` there closes the field it belongs to.
   */
  readonly openAtEnd: readonly string[];
}
interface HeldParagraphLinks extends ParagraphLinks {
  readonly openAtStart: readonly string[];
}
/** Paragraphs are immutable, so an unchanged TOC row keeps its link spans across edits. */
const linkSpanCache = new FieldResultsModeMemo<OoxmlNode, HeldParagraphLinks>();
/** Enough of an instruction to read its field type; the rest is never needed here. */
const LINK_INSTRUCTION_PREFIX = 32;

function isHyperlinkInstruction(instruction: string): boolean {
  return /^\s*HYPERLINK(?![A-Za-z])/i.test(instruction);
}

/**
 * Where a paragraph holds link content: `w:hyperlink` elements, `HYPERLINK` simple fields, and
 * complex `HYPERLINK` fields from `begin` to their own `end`. The spans come from the paragraph
 * offset index, so an atomic field contributes its single unit. Fields still open at the end
 * of the previous paragraph start at offset 0, so a link that crosses a paragraph mark covers
 * the rest of its first paragraph and the start of the next, also with a nested field.
 */
function linkSpansOf(
  paragraph: OoxmlNode,
  offsets: ParagraphOffsetIndex,
  openAtStart: readonly string[]
): ParagraphLinks {
  const held = linkSpanCache.get(paragraph);
  if (
    held?.openAtStart.length === openAtStart.length &&
    held.openAtStart.every((instruction, index) => instruction === openAtStart[index])
  ) {
    return held;
  }
  const spans: TocLinkRange[] = [];
  const add = (start: number | undefined, end: number | undefined) => {
    if (start !== undefined && end !== undefined && end > start) spans.push({ start, end });
  };
  const fields: { instruction: string; start?: number }[] = openAtStart.map((instruction) => ({
    instruction,
    start: 0,
  }));
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
      fields.push({ instruction: '', start: offsets.spanOf(node)?.start });
    } else if (type === 'end') {
      // The innermost open field owns this `end`, whatever its type.
      const field = fields.pop();
      if (field && isHyperlinkInstruction(field.instruction)) {
        add(field.start, offsets.spanOf(node)?.end);
      }
    } else if (isInstrText(node)) {
      const field = fields.at(-1);
      if (field && field.instruction.length < LINK_INSTRUCTION_PREFIX) {
        field.instruction += instrTextValue(node).slice(0, LINK_INSTRUCTION_PREFIX);
      }
    }
    for (const child of node.children) visit(child, depth + 1);
  };
  visit(paragraph, 0);
  const openLink = fields.find((field) => isHyperlinkInstruction(field.instruction));
  if (openLink) add(openLink.start ?? 0, offsets.length);
  const links = { spans, openAtEnd: fields.map((field) => field.instruction), openAtStart };
  linkSpanCache.set(paragraph, links);
  return links;
}

/**
 * The parts of TOC results that drop the Hyperlink character style: link content inside the
 * cached result. Text outside a link keeps the style, whatever the `\h` switch says.
 *
 * Exception: a TOC whose `begin` and `end` are in one paragraph is a single atomic unit in the
 * offset index. Its result has no offsets of its own, so the whole unit drops the style. Text
 * outside a link in such a TOC loses the Hyperlink style too.
 */
export function tocLinkRanges(part: OoxmlPart): TocLinkRanges {
  const held = cache.get(part);
  if (held) return held;
  const ranges = new Map<string, TocLinkRange[]>();
  for (const toc of detectBodyTocs(part)) {
    const field = tocFieldRange(toc);
    if (!field) continue;
    let openFields: readonly string[] = [];
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
        ? [{ start, end }]
        : links.spans.flatMap((link) =>
            link.end > start && link.start < end
              ? [{ start: Math.max(start, link.start), end: Math.min(end, link.end) }]
              : []
          );
      if (linked.length === 0) continue;
      const list = ranges.get(id) ?? [];
      list.push(...linked);
      ranges.set(id, list);
    }
  }
  cache.set(part, ranges);
  return ranges;
}

/** A run cascader over one style table, so a TOC walk can find the Hyperlink style by definition. */
export interface TocAwareRunCascader extends RunPropertyCascader {
  readonly styles: StyleCascadeTable;
}

/** The paint and AutoFit walks build their cascader here, so TOC link ranges can apply. */
export function tocAwareRunCascader(styles?: StyleCascadeTable): TocAwareRunCascader | undefined {
  if (!styles) return undefined;
  const cascade: RunPropertyCascader = (inherited, direct) =>
    cascadeRunProperties(inherited, direct, styles);
  return Object.assign(cascade, { styles });
}

function isTocAware(cascade: RunPropertyCascader): cascade is TocAwareRunCascader {
  return 'styles' in cascade;
}

/**
 * Drop the Hyperlink character style reference from direct properties inside the given ranges.
 * The style is resolved by its definition in the cascader's own style table. TOC ranges with a
 * cascader that is not from {@link tocAwareRunCascader} are refused: the walk throws, because
 * the result would silently keep the link formatting.
 */
export function tocLinkCascader(
  cascade: RunPropertyCascader | undefined,
  ranges: readonly TocLinkRange[] | undefined,
  position: () => number
): RunPropertyCascader | undefined {
  if (!cascade || !ranges?.length) return cascade;
  if (!isTocAware(cascade)) {
    throw new Error('TOC link ranges need a run cascader from tocAwareRunCascader');
  }
  const { styles } = cascade;
  return (inherited, direct) => {
    const at = position();
    const linked = ranges.some((r) => at >= r.start && at < r.end);
    return cascade(
      inherited,
      linked ? direct.filter((p) => !isHyperlinkStyleReference(p, styles)) : direct
    );
  };
}

function isHyperlinkStyleReference(property: OoxmlProperty, styles: StyleCascadeTable): boolean {
  const id = property.localName === 'rStyle' ? property.attributes?.val : undefined;
  if (!id) return false;
  const definition = styles.styles.get(id);
  if (definition?.type !== 'character') return false;
  // The built-in style is known by its name; the id can be localized or numeric. Only a
  // definition without a name falls back to the id.
  return (definition.name ?? id).toLowerCase() === 'hyperlink';
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
  for (const [paragraphId, list] of ranges) {
    parts.push(paragraphId, list.map((range) => `${range.start},${range.end}`).join(';'));
  }
  const token = fnv1a64Hex(framedTokenJoin(parts));
  tokens.set(ranges, token);
  return token;
}

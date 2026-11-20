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
  /** A `HYPERLINK` field is still open at the paragraph end, so it continues in the next one. */
  readonly openAtEnd: boolean;
}
/** Paragraphs are immutable, so an unchanged TOC row keeps its link spans across edits. */
const linkSpanCache = new FieldResultsModeMemo<OoxmlNode, ParagraphLinks>();
/** Enough of an instruction to read its field type; the rest is never needed here. */
const LINK_INSTRUCTION_PREFIX = 32;

function isHyperlinkInstruction(instruction: string): boolean {
  return /^\s*HYPERLINK(?![A-Za-z])/i.test(instruction);
}

/**
 * Where a paragraph holds link content: `w:hyperlink` elements, `HYPERLINK` simple fields, and
 * complex `HYPERLINK` fields from `begin` to `end`. The spans come from the paragraph offset
 * index, so an atomic field contributes its single unit. A complex link that crosses a
 * paragraph mark covers the rest of its first paragraph and the start of the next.
 */
function linkSpansOf(
  paragraph: OoxmlNode,
  offsets: ParagraphOffsetIndex,
  openAtStart: boolean
): ParagraphLinks {
  const held = openAtStart ? undefined : linkSpanCache.get(paragraph);
  if (held) return held;
  const spans: TocLinkRange[] = [];
  const add = (start: number | undefined, end: number | undefined) => {
    if (start !== undefined && end !== undefined && end > start) spans.push({ start, end });
  };
  const fields: { instruction: string; start?: number }[] = openAtStart
    ? [{ instruction: 'HYPERLINK', start: 0 }]
    : [];
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
  const open = fields.filter((field) => isHyperlinkInstruction(field.instruction));
  if (open.length > 0) add(open[0]!.start ?? 0, offsets.length);
  const links = { spans, openAtEnd: open.length > 0 };
  if (!openAtStart) linkSpanCache.set(paragraph, links);
  return links;
}

/**
 * The parts of TOC results that drop the Hyperlink character style: link content inside the
 * cached result. Text outside a link keeps the style, whatever the `\h` switch says.
 */
export function tocLinkRanges(part: OoxmlPart): TocLinkRanges {
  const held = cache.get(part);
  if (held) return held;
  const ranges = new Map<string, TocLinkRange[]>();
  for (const toc of detectBodyTocs(part)) {
    const field = tocFieldRange(toc);
    if (!field) continue;
    let linkOpen = false;
    for (const id of new Set([
      field.separateParagraphId,
      ...toc.resultParagraphIds,
      toc.endParagraphId,
    ])) {
      const paragraph = findNode(part, id);
      if (paragraph?.kind !== 'paragraph') continue;
      const offsets = paragraphOffsetIndex(paragraph);
      const links = linkSpansOf(paragraph, offsets, linkOpen);
      linkOpen = links.openAtEnd;
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

/**
 * Wrap a cascader so it receives `suppressHyperlinkStyle` inside the given ranges. The wrapped
 * cascader must come from {@link tocAwareRunCascader}; another one ignores the flag.
 */
export function tocLinkCascader(
  cascade: RunPropertyCascader | undefined,
  ranges: readonly TocLinkRange[] | undefined,
  position: () => number
): RunPropertyCascader | undefined {
  if (!cascade || !ranges?.length) return cascade;
  return (inherited, direct) =>
    cascade(
      inherited,
      direct,
      ranges.some((r) => position() >= r.start && position() < r.end)
    );
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

/** The paint and AutoFit walks must both resolve the TOC hyperlink style by its definition. */
export function tocAwareRunCascader(styles?: StyleCascadeTable): RunPropertyCascader | undefined {
  if (!styles) return undefined;
  return (inherited, direct, suppressHyperlinkStyle) =>
    cascadeRunProperties(
      inherited,
      suppressHyperlinkStyle ? direct.filter((p) => !isHyperlinkStyleReference(p, styles)) : direct,
      styles
    );
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

import { FieldResultsModeMemo } from '../store/package/field-result-mode.ts';
import { fnv1a64Hex } from '../store/comparators/canonical.ts';
import { framedTokenJoin } from './layout-cache.ts';
import type { OoxmlPart } from '../store/package/ooxml-tree.ts';
import type { OoxmlProperty } from '../store/store/tree-op-types.ts';
import { findNode } from '../store/package/ooxml-edit.ts';
import { detectBodyTocs, tocFieldRange } from '../store/package/toc-detect.ts';
import { paragraphOffsetIndex } from '../store/store/tree-op-segments.ts';
import type { RunPropertyCascader } from './field-run-text.ts';
import { cascadeRunProperties, type StyleCascadeTable } from './style-cascade.ts';

export interface TocLinkRange {
  readonly start: number;
  readonly end: number;
}
export type TocLinkRanges = ReadonlyMap<string, readonly TocLinkRange[]>;
/** Offsets differ between field-result modes, so each mode keeps its own entry. */
const cache = new FieldResultsModeMemo<OoxmlPart, TocLinkRanges>();

/** Only actual TOC results suppress the Hyperlink character style, as in Word. */
export function tocLinkRanges(part: OoxmlPart): TocLinkRanges {
  const held = cache.get(part);
  if (held) return held;
  const ranges = new Map<string, TocLinkRange[]>();
  for (const toc of detectBodyTocs(part)) {
    const field = tocFieldRange(toc);
    if (!field) continue;
    for (const id of new Set([
      field.separateParagraphId,
      ...toc.resultParagraphIds,
      toc.endParagraphId,
    ])) {
      const paragraph = findNode(part, id);
      if (paragraph?.kind !== 'paragraph') continue;
      const offsets = paragraphOffsetIndex(paragraph);
      const atom =
        toc.beginParagraphId === toc.endParagraphId ? offsets.spanOf(toc.beginNodeId) : undefined;
      const start =
        atom?.start ??
        (id === field.separateParagraphId ? offsets.spanOf(field.separateNodeId)?.end : 0);
      const end =
        atom?.end ??
        (id === toc.endParagraphId ? offsets.spanOf(field.endNodeId)?.start : offsets.length);
      if (start === undefined || end === undefined || end <= start) continue;
      const list = ranges.get(id) ?? [];
      list.push({ start, end });
      ranges.set(id, list);
    }
  }
  cache.set(part, ranges);
  return ranges;
}

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
  return (
    definition?.type === 'character' &&
    (id.toLowerCase() === 'hyperlink' || definition.name?.toLowerCase() === 'hyperlink')
  );
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

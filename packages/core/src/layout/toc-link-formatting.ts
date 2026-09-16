import { stableHash } from '../store/comparators/canonical.ts';
import type { OoxmlPart } from '../store/package/ooxml-tree.ts';
import { findNode } from '../store/package/ooxml-edit.ts';
import { detectBodyTocs, tocFieldRange } from '../store/package/toc-detect.ts';
import { paragraphOffsetIndex } from '../store/store/tree-op-segments.ts';
import type { RunPropertyCascader } from './field-run-text.ts';

export interface TocLinkRange {
  readonly start: number;
  readonly end: number;
}
export type TocLinkRanges = ReadonlyMap<string, readonly TocLinkRange[]>;
const cache = new WeakMap<OoxmlPart, TocLinkRanges>();

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
      ranges.some((r) => position() >= r.start && position() < r.end)
        ? direct.filter((p) => !(p.localName === 'rStyle' && p.attributes?.val === 'Hyperlink'))
        : direct
    );
}

const tokens = new WeakMap<TocLinkRanges, string>();
/** Cross-paragraph field membership can change while a cached result paragraph stays identical. */
export function tocLinkStyleToken(ranges: TocLinkRanges): string {
  if (ranges.size === 0) return '';
  const held = tokens.get(ranges);
  if (held !== undefined) return held;
  const token = stableHash([...ranges]);
  tokens.set(ranges, token);
  return token;
}

import { findNode } from '../store/package/ooxml-edit.ts';
// Field boundaries, rather than paragraph ownership, define the generated read-only region.
import { paragraphOffsetIndex, type OoxmlPart, type TreeDocOp } from '@docx-editor.dev/core/store';
import { detectBodyTocs, tocFieldRange, type DetectedToc } from '../store/package/toc-detect.ts';
import { treeOpReach } from '../store/store/tree-op-content-controls.ts';
import type { SemanticPosition, SemanticSelection } from '../layout/semantic-interaction.ts';

/** The refusal of a write into a generated table of contents. */
export const TOC_READ_ONLY_REFUSAL = 'the table of contents is generated and read-only';

export interface TocParagraphRange {
  readonly toc: DetectedToc;
  readonly paragraphId: string;
  readonly start: number;
  readonly end: number;
  readonly length: number;
  readonly startsHere: boolean;
  readonly endsHere: boolean;
}
const cache = new WeakMap<OoxmlPart, readonly TocParagraphRange[]>();
export function tocParagraphRanges(part: OoxmlPart): readonly TocParagraphRange[] {
  const cached = cache.get(part);
  if (cached) return cached;
  const tocs = detectBodyTocs(part);
  if (tocs.length === 0) {
    cache.set(part, []);
    return [];
  }
  const ranges: TocParagraphRange[] = [];
  for (const toc of tocs) {
    const field = tocFieldRange(toc);
    for (const paragraphId of new Set([
      toc.beginParagraphId,
      ...toc.resultParagraphIds,
      toc.endParagraphId,
    ])) {
      const paragraph = findNode(part, paragraphId);
      if (paragraph?.kind !== 'paragraph') continue;
      const offsets = paragraphOffsetIndex(paragraph);
      const startsHere = paragraphId === toc.beginParagraphId;
      const endsHere = paragraphId === toc.endParagraphId;
      ranges.push({
        toc,
        paragraphId,
        length: offsets.length,
        startsHere,
        endsHere,
        start: startsHere ? (offsets.spanOf(toc.beginNodeId)?.start ?? 0) : 0,
        end:
          endsHere && field
            ? (offsets.spanOf(field.endNodeId)?.end ?? offsets.length)
            : offsets.length,
      });
    }
  }
  cache.set(part, ranges);
  return ranges;
}
export function fullyProtectedTocParagraphs(part: OoxmlPart): ReadonlySet<string> {
  return new Set(
    tocParagraphRanges(part)
      .filter(
        (r) => r.start === 0 && r.end === r.length && !(r.endsHere && !r.startsHere && r.end === 0)
      )
      .map((r) => r.paragraphId)
  );
}
function contains(range: TocParagraphRange, offset: number): boolean {
  if (range.endsHere && !range.startsHere && range.end === 0) return false;
  if (range.startsHere && range.start > 0 && offset <= range.start) return false;
  if (range.endsHere && range.end < range.length && offset >= range.end) return false;
  return offset >= range.start && offset <= range.end;
}
/** Whether a write over `[start, end)` of the range's paragraph reaches generated content. */
function rangeTouches(range: TocParagraphRange, start: number, end: number): boolean {
  return start === end ? contains(range, start) : start < range.end && end > range.start;
}
/**
 * Whether a paragraph-level write (its properties or its mark) reaches generated content:
 * the paragraph holds generated text, or only field characters (such as a shown closing
 * line). An end paragraph whose end mark comes first, before a heading, holds no generated
 * text, so it keeps accepting paragraph formatting.
 */
function paragraphWriteTouches(range: TocParagraphRange): boolean {
  return range.end > range.start || range.length === 0;
}
export function tocAtPosition(
  part: OoxmlPart,
  position: SemanticPosition
): DetectedToc | undefined {
  return tocParagraphRanges(part).find(
    (r) => r.paragraphId === position.paragraphId && contains(r, position.offset)
  )?.toc;
}
/**
 * The TOC that caret motion from `origin` skips at `position`: its read-only region, and a
 * closing paragraph that holds only the end mark when the motion arrives from another
 * paragraph. A caret placed on that closing line stays there for Home and End, and the
 * line stays editable, so the reader can retype a deleted heading there.
 */
export function tocSkippedByCaretMotion(
  part: OoxmlPart,
  position: SemanticPosition,
  origin: SemanticPosition
): DetectedToc | undefined {
  return tocParagraphRanges(part).find(
    (r) =>
      r.paragraphId === position.paragraphId &&
      (contains(r, position.offset) ||
        (r.endsHere && !r.startsHere && r.length === 0 && origin.paragraphId !== r.paragraphId))
  )?.toc;
}
export function selectionTouchesTocRange(part: OoxmlPart, selection: SemanticSelection): boolean {
  const { anchor, head } = selection;
  if (anchor.paragraphId === head.paragraphId) {
    const start = Math.min(anchor.offset, head.offset),
      end = Math.max(anchor.offset, head.offset);
    return tocParagraphRanges(part).some(
      (r) => r.paragraphId === anchor.paragraphId && rangeTouches(r, start, end)
    );
  }
  // Whole controls can be removed by a surrounding selection. The operation guard checks
  // writes into generated paragraphs; selection endpoints catch edits starting inside one.
  return tocAtPosition(part, anchor) !== undefined || tocAtPosition(part, head) !== undefined;
}
export function opTouchesTocRange(part: OoxmlPart, op: TreeDocOp): boolean {
  const ranges = tocParagraphRanges(part);
  if (ranges.length === 0) return false;
  const reach = treeOpReach(op);
  if (reach.kind === 'nodes') {
    return reach.targets.some((target) =>
      ranges.some((r) => {
        if (target.nodeId !== r.paragraphId) return false;
        if (target.range) {
          return rangeTouches(r, target.range.start, target.range.end);
        }
        if (op.op === 'joinParagraphs' && op.firstId === r.paragraphId && r.endsHere && r.end === 0)
          return false;
        if (target.removes || target.structural) return true;
        return paragraphWriteTouches(r);
      })
    );
  }
  // Retain the existing refusal for paragraph ids in other operation shapes.
  const ids = new Set(ranges.map((r) => r.paragraphId));
  const inspect = (value: unknown, key = ''): boolean => {
    if (typeof value === 'string') return /(?:Id|Ids)$/.test(key) && ids.has(value);
    if (Array.isArray(value)) return value.some((v) => inspect(v, key));
    return (
      !!value && typeof value === 'object' && Object.entries(value).some(([k, v]) => inspect(v, k))
    );
  };
  return inspect(op);
}

/**
 * Whether the TOC guard refuses a join of `paragraphIds` into the first one: every one
 * of them is removed or restructured, except a first paragraph that holds only the end
 * mark (the guard lets the next paragraph join it).
 */
export function tocRefusesJoin(part: OoxmlPart, paragraphIds: readonly string[]): boolean {
  const ranges = tocParagraphRanges(part);
  return paragraphIds.some((id, index) =>
    ranges.some(
      (r) => r.paragraphId === id && !(index === 0 && r.endsHere && !r.startsHere && r.end === 0)
    )
  );
}
/**
 * Whether the TOC guard refuses text written over the selection. Inside one paragraph it
 * asks {@link selectionTouchesTocRange}. A range across paragraphs also removes the ones
 * between its ends and joins its ends, so it asks {@link tocRefusesJoin} too.
 */
export function tocRefusesTextWrite(
  part: OoxmlPart,
  selection: SemanticSelection,
  paragraphIds: readonly string[]
): boolean {
  if (selectionTouchesTocRange(part, selection)) return true;
  if (selection.anchor.paragraphId === selection.head.paragraphId) return false;
  return tocRefusesJoin(part, paragraphIds);
}
/** Whether the end of a paragraph, where an anchored object is inserted, is generated. */
export function tocAtParagraphEnd(part: OoxmlPart, paragraphId: string): boolean {
  return tocParagraphRanges(part).some(
    (r) => r.paragraphId === paragraphId && contains(r, r.length)
  );
}
/** One paragraph's selected span, `[start, end)` in its own offsets. */
export interface TocSelectedSpan {
  readonly paragraphId: string;
  readonly start: number;
  readonly end: number;
}
/**
 * Whether the TOC guard refuses a run format over `spans`. It asks the predicates
 * `opTouchesTocRange` asks of each op. Most formats drop the writes that reach generated
 * text and refuse only when none is left: a span that reaches ordinary text keeps a write,
 * as does a caret where typed text would land. The format painter writes the selection as
 * one unit, so `whole` refuses it when any write reaches generated text. A caret in an
 * empty paragraph, or a span past the last character, writes the paragraph mark.
 */
export function tocRefusesRunFormatting(
  part: OoxmlPart,
  spans: readonly TocSelectedSpan[],
  whole: boolean
): boolean {
  const ranges = tocParagraphRanges(part);
  if (ranges.length === 0 || spans.length === 0) return false;
  const reaches = (span: TocSelectedSpan, inside: boolean) =>
    ranges.some((r) => {
      if (r.paragraphId !== span.paragraphId) return false;
      if (span.start === span.end) return contains(r, span.start) || r.length === 0;
      const end = Math.min(span.end, r.length);
      if (span.start >= end) return paragraphWriteTouches(r);
      // Text before `r.start` or after `r.end` is ordinary and keeps its write.
      const touches = rangeTouches(r, span.start, end);
      return inside ? touches && span.start >= r.start && end <= r.end : touches;
    });
  return whole ? spans.some((span) => reaches(span, false)) : spans.every((s) => reaches(s, true));
}
/**
 * Whether the TOC guard refuses a paragraph format over `paragraphIds`. Most formats drop
 * the writes that reach a TOC paragraph and refuse only when none is left. A list or an
 * indent step writes the selection as one unit, so `whole` refuses it when any write
 * reaches one.
 */
export function tocRefusesParagraphFormatting(
  part: OoxmlPart,
  paragraphIds: readonly string[],
  whole: boolean
): boolean {
  const ranges = tocParagraphRanges(part);
  if (ranges.length === 0 || paragraphIds.length === 0) return false;
  const touches = (id: string) =>
    ranges.some((r) => r.paragraphId === id && paragraphWriteTouches(r));
  return whole ? paragraphIds.some(touches) : paragraphIds.every(touches);
}

export function tocEscapePosition(
  part: OoxmlPart,
  position: SemanticPosition,
  backwards: boolean
): SemanticPosition | null {
  const toc = tocAtPosition(part, position);
  if (!toc) return null;
  const range = tocParagraphRanges(part).find(
    (r) =>
      r.toc.id === toc.id &&
      (backwards ? r.startsHere && r.start > 0 : r.endsHere && r.end < r.length)
  );
  return range
    ? { paragraphId: range.paragraphId, offset: backwards ? range.start : range.end }
    : null;
}

export function tocControlId(toc: DetectedToc, part: OoxmlPart): string {
  const partial = tocParagraphRanges(part).some(
    (range) => range.toc.id === toc.id && (range.start > 0 || range.end < range.length)
  );
  return !partial && toc.contentControlId ? toc.contentControlId : `toc:${toc.id}`;
}

export function tocForElement(
  part: OoxmlPart,
  paragraphId: string | null | undefined,
  target: Element | null
): DetectedToc | undefined {
  if (!paragraphId) return undefined;
  const run = target?.closest<HTMLElement>('[data-start]');
  return tocParagraphRanges(part).find(
    (range) =>
      range.paragraphId === paragraphId &&
      (run
        ? Number(run.dataset.start) < range.end && Number(run.dataset.end) > range.start
        : fullyProtectedTocParagraphs(part).has(paragraphId))
  )?.toc;
}

/** Whether a body paragraph belongs to a detected TOC boundary or cached result. */
export function paragraphInBodyToc(part: OoxmlPart, paragraphId: string): boolean {
  return detectBodyTocs(part).some(
    (toc) =>
      toc.beginParagraphId === paragraphId ||
      toc.endParagraphId === paragraphId ||
      toc.resultParagraphIds.includes(paragraphId)
  );
}

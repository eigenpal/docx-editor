import { findNode } from '../store/package/ooxml-edit.ts';
// Field boundaries, rather than paragraph ownership, define the generated read-only region.
import { paragraphOffsetIndex, type OoxmlPart, type TreeDocOp } from '@docx-editor.dev/core/store';
import { detectBodyTocs, tocFieldRange, type DetectedToc } from '../store/package/toc-detect.ts';
import { treeOpReach } from '../store/store/tree-op-content-controls.ts';
import { parentOf } from '../store/store/tree-op-nodes.ts';
import type { SemanticPosition, SemanticSelection } from '../layout/semantic-interaction.ts';

/** The refusal of a write into a generated table of contents. */
export const TOC_READ_ONLY_REFUSAL = 'the table of contents is generated and read-only';
/** A table or TOC at the caret would land inside a TOC field: no paragraph boundary is there. */
export const TOC_BLOCK_REFUSAL =
  'this would land inside the table of contents; add a paragraph after this line first';

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
const paragraphIdCache = new WeakMap<OoxmlPart, ReadonlySet<string>>();
/** The paragraphs that hold part of a TOC field, from {@link tocParagraphRanges}. */
export function tocParagraphIdSet(part: OoxmlPart): ReadonlySet<string> {
  const cached = paragraphIdCache.get(part);
  if (cached) return cached;
  const ids = new Set(tocParagraphRanges(part).map((range) => range.paragraphId));
  paragraphIdCache.set(part, ids);
  return ids;
}
export function fullyProtectedTocParagraphs(part: OoxmlPart): ReadonlySet<string> {
  return new Set(
    tocParagraphRanges(part)
      .filter((r) => r.start === 0 && r.end === r.length && !holdsOnlyEndMark(r))
      .map((r) => r.paragraphId)
  );
}
/** Whether the range's paragraph starts with the end mark, as a closing line does. */
function holdsOnlyEndMark(range: TocParagraphRange): boolean {
  return range.endsHere && !range.startsHere && range.end === 0;
}
function contains(range: TocParagraphRange, offset: number): boolean {
  if (holdsOnlyEndMark(range)) return false;
  if (range.startsHere && range.start > 0 && offset <= range.start) return false;
  if (range.endsHere && range.end < range.length && offset >= range.end) return false;
  return offset >= range.start && offset <= range.end;
}
/**
 * Whether content written at `offset` lands in the field result. The field's own edges are
 * outside it, even where the caret counts as inside a row ({@link contains}): content placed
 * there goes before the begin `w:fldChar` or after the end `w:fldChar`
 * (`store/store/tree-op-field-edge.ts`).
 */
function writeLandsInside(range: TocParagraphRange, offset: number): boolean {
  if (range.startsHere && offset === range.start) return false;
  if (range.endsHere && offset === range.end) return false;
  return contains(range, offset);
}
/** Whether a write over `[start, end)` of the range's paragraph reaches generated content. */
function rangeTouches(range: TocParagraphRange, start: number, end: number): boolean {
  return start === end ? writeLandsInside(range, start) : start < range.end && end > range.start;
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
/** Maps an offset an op names back to the part before its batch; see `batchTouchesTocRange`. */
type BatchOffset = (paragraphId: string, offset: number) => number;
const unmoved: BatchOffset = (_paragraphId, offset) => offset;

export function opTouchesTocRange(
  part: OoxmlPart,
  op: TreeDocOp,
  before: BatchOffset = unmoved
): boolean {
  const ranges = tocParagraphRanges(part);
  if (ranges.length === 0) return false;
  // A block before a paragraph inside an existing TOC would land in its field.
  if (op.op === 'insertToc' || op.op === 'insertTable') {
    return tocRefusesInsertBefore(part, op.beforeParagraphId);
  }
  const reach = treeOpReach(op);
  if (reach.kind === 'nodes') {
    return reach.targets.some((target) =>
      ranges.some((r) => {
        if (target.nodeId !== r.paragraphId) return false;
        if (target.range) {
          const { start, end } = target.range;
          return rangeTouches(r, before(r.paragraphId, start), before(r.paragraphId, end));
        }
        // The paragraph a TOC ends in takes the next paragraph's join: the joined text lands
        // after its end mark. A closing line that holds only the end mark also takes a section
        // break that ends there. Neither changes the field.
        if (r.endsHere && op.op === 'joinParagraphs' && op.firstId === r.paragraphId) return false;
        if (holdsOnlyEndMark(r) && op.op === 'setSectionMark') return false;
        if (target.removes || target.structural) return true;
        return paragraphWriteTouches(r);
      })
    );
  }
  // Text typed inside a content control (a TOC control included) names the control and the
  // position it lands at; the position decides, as for a range op.
  if (reach.kind === 'control' && reach.at && !reach.replacesContent) {
    const { paragraphId } = reach.at;
    const offset = before(paragraphId, reach.at.offset);
    return ranges.some((r) => r.paragraphId === paragraphId && rangeTouches(r, offset, offset));
  }
  // Page setup names the paragraph whose section it writes; the section is not TOC content.
  if (op.op === 'setSectionProperties') return false;
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
 * Whether any op of a batch reaches generated content. The ranges describe the part before
 * the batch, so a later op's offsets are read back through the text that earlier ops insert
 * or delete: a link wrapped around text the batch just typed names that text, not the TOC.
 */
export function batchTouchesTocRange(
  part: OoxmlPart,
  ops: readonly TreeDocOp[],
  /** The batch is attributed as tracked changes when committed (suggesting mode). */
  tracked = false
): boolean {
  const edits: { paragraphId: string; at: number; inserted: number; deleted: number }[] = [];
  const before: BatchOffset = (paragraphId, offset) => {
    let at = offset;
    for (let index = edits.length - 1; index >= 0; index -= 1) {
      const edit = edits[index]!;
      if (edit.paragraphId !== paragraphId || at <= edit.at) continue;
      at = at >= edit.at + edit.inserted ? at - edit.inserted + edit.deleted : edit.at;
    }
    return at;
  };
  for (const op of ops) {
    if (opTouchesTocRange(part, op, before)) return true;
    if (op.op === 'insertText') {
      edits.push({
        paragraphId: op.paragraphId,
        at: op.offset,
        inserted: op.text.length,
        deleted: 0,
      });
    } else if (op.op === 'deleteText' && !op.revision && !tracked) {
      // A tracked deletion strikes the text in place, so later offsets do not move.
      const deleted = op.end - op.start;
      edits.push({ paragraphId: op.paragraphId, at: op.start, inserted: 0, deleted });
    }
  }
  return false;
}
/**
 * Whether the TOC guard protects a paragraph from paragraph-level writes (its properties,
 * its mark, a table split): it holds generated text, or only the end mark. A closing line
 * that also holds a heading takes them freely.
 */
export function tocProtectsParagraph(part: OoxmlPart, paragraphId: string): boolean {
  return tocParagraphRanges(part).some(
    (r) => r.paragraphId === paragraphId && paragraphWriteTouches(r)
  );
}
/** Whether a paragraph is a closing line: it starts with a TOC's end mark. */
export function tocIsClosingLine(part: OoxmlPart, paragraphId: string): boolean {
  return tocParagraphRanges(part).some((r) => r.paragraphId === paragraphId && holdsOnlyEndMark(r));
}
/**
 * The paragraph a block inserted at the caret (a table or a TOC) goes before. A block goes
 * before the caret's paragraph, except on a closing line: there it would land inside the
 * field result, so it goes after the closing line, as a pasted table does. Null when no
 * paragraph follows the closing line in its container.
 */
export function tocBlockAnchor(part: OoxmlPart, paragraphId: string): string | null {
  if (!tocIsClosingLine(part, paragraphId)) return paragraphId;
  const siblings = parentOf(part, paragraphId)?.children ?? [];
  const next = siblings[siblings.findIndex((child) => child.id === paragraphId) + 1];
  return next?.kind === 'paragraph' ? next.id : null;
}
/**
 * Whether the TOC guard refuses a block (a table or a TOC) inserted before a paragraph: any
 * TOC paragraph except the one where a TOC begins, since a block there would land in the field.
 */
export function tocRefusesInsertBefore(part: OoxmlPart, paragraphId: string): boolean {
  return tocParagraphRanges(part).some((r) => r.paragraphId === paragraphId && !r.startsHere);
}
/** Whether the TOC guard refuses a section mark on a paragraph (see `opTouchesTocRange`). */
export function tocRefusesSectionMark(part: OoxmlPart, paragraphId: string): boolean {
  return tocParagraphRanges(part).some(
    (r) => r.paragraphId === paragraphId && !holdsOnlyEndMark(r)
  );
}
/**
 * Whether the TOC guard refuses a join of `paragraphIds` into the first one: every one
 * of them is removed or restructured, except a first paragraph that a TOC ends in (the
 * joined text lands after its end mark, so the guard lets the next paragraph join it).
 */
export function tocRefusesJoin(part: OoxmlPart, paragraphIds: readonly string[]): boolean {
  const ranges = tocParagraphRanges(part);
  return paragraphIds.some((id, index) =>
    ranges.some((r) => r.paragraphId === id && !(index === 0 && r.endsHere))
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
 * one unit, so `whole` refuses it when any write reaches generated text. A span past the
 * last character writes the paragraph mark. At a caret in an empty closing line a format is
 * armed for the next typed text, unless `writesEmptyMark` (clearing writes the mark).
 */
export function tocRefusesRunFormatting(
  part: OoxmlPart,
  spans: readonly TocSelectedSpan[],
  { whole, writesEmptyMark }: { readonly whole: boolean; readonly writesEmptyMark: boolean }
): boolean {
  const ranges = tocParagraphRanges(part);
  if (ranges.length === 0 || spans.length === 0) return false;
  const reaches = (span: TocSelectedSpan, inside: boolean) =>
    ranges.some((r) => {
      if (r.paragraphId !== span.paragraphId) return false;
      if (span.start === span.end)
        return writeLandsInside(r, span.start) || (writesEmptyMark && r.length === 0);
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

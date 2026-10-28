import type { StyleSpanRecord } from './semantic-records.ts';

/** A float passage of one line, in the same x space as the line's spans. */
export interface LinePassage {
  readonly start: number;
  readonly end: number;
  /**
   * Where the pen began this passage, when the line broke in mirrored x
   * (`rtl-wrap-mirror.ts`). `start` and `end` are then the physical passage, and the line's
   * spans still stand at their pen x until {@link alignBidiPassageSpans} moves each part.
   */
  readonly breakStart?: number;
}

type AlignPart = (
  part: readonly StyleSpanRecord[],
  passage: LinePassage,
  isLastPart: boolean
) => readonly StyleSpanRecord[];

/** A line's parts: a float's real jump starts a new one, and that span loses its jump. */
function passageParts(spans: readonly StyleSpanRecord[]): StyleSpanRecord[][] {
  const parts: StyleSpanRecord[][] = [];
  for (const [index, span] of spans.entries()) {
    const previous = spans[index - 1];
    // A jump is real only where the span does not touch the one before it.
    const jumps =
      previous !== undefined &&
      (span.wrapAdvanceBefore ?? 0) > 0.001 &&
      span.box.x > previous.box.x + previous.box.width + 0.001;
    // The part aligns as a line of its own, which has no jump before it; the jump is measured
    // again once the part is placed.
    const { wrapAdvanceBefore: _jump, ...own } = span;
    if (index === 0 || jumps) parts.push([own]);
    else parts[parts.length - 1]!.push(span);
  }
  return parts;
}

/**
 * The passage each part lies in: the last one that starts at or before the part's first span,
 * measured where the pen placed it. Null unless the parts take increasing passages.
 */
function passageOwners(
  parts: readonly (readonly StyleSpanRecord[])[],
  passages: readonly LinePassage[]
): LinePassage[] | null {
  let previousPassage = -1;
  const owners: LinePassage[] = [];
  for (const part of parts) {
    const x = part[0]!.box.x;
    let owner = -1;
    for (let index = passages.length - 1; index >= 0; index -= 1) {
      const passage = passages[index]!;
      if ((passage.breakStart ?? passage.start) <= x + 0.001) {
        owner = index;
        break;
      }
    }
    if (owner <= previousPassage) return null;
    previousPassage = owner;
    owners.push(passages[owner]!);
  }
  return owners;
}

/**
 * Align each part of a line that steps over a float inside its own passage.
 *
 * A float's jump starts a new part: the span after it carries `wrapAdvanceBefore`. Each part
 * aligns in the passage that holds its first span, as if that passage were the line, and only
 * the last part can align as the paragraph's last line. The jump before each later part is then
 * measured again, because paint and hit testing read it as the gap the float leaves.
 *
 * Returns null when the parts do not map one to one onto increasing passages, so the caller
 * keeps aligning the line as one block.
 */
export function alignPassageSpans(
  spans: readonly StyleSpanRecord[],
  passages: readonly LinePassage[],
  alignPart: AlignPart
): readonly StyleSpanRecord[] | null {
  const parts = passageParts(spans);
  if (parts.length < 2) return null;
  const owners = passageOwners(parts, passages);
  if (!owners) return null;
  const aligned: StyleSpanRecord[] = [];
  for (const [index, part] of parts.entries()) {
    const isLastPart = index === parts.length - 1;
    const passage = owners[index]!;
    const placed = alignPart(part, passage, isLastPart);
    const previous = aligned[aligned.length - 1];
    const first = placed[0];
    if (previous && first) {
      const gap = first.box.x - (previous.box.x + previous.box.width);
      const { wrapAdvanceBefore: _old, ...rest } = first;
      aligned.push(gap > 0.001 ? { ...rest, wrapAdvanceBefore: gap } : rest, ...placed.slice(1));
    } else aligned.push(...placed);
  }
  return aligned;
}

/**
 * {@link alignPassageSpans} for a line that bidi resolution reorders. Each part aligns and
 * reorders inside its own passage as a line of its own (`alignPart`), so text never reorders
 * across a float, and the spans keep their logical order.
 *
 * A right-to-left paragraph breaks in mirrored x, and its passages carry `breakStart`
 * ({@link LinePassage}). Its first part then lies in the rightmost passage and later parts run
 * leftward; each part moves to its physical passage before it aligns. Each later part's first
 * span records the physical gap to the part before it as `wrapAdvanceBefore`, which keeps the
 * parts apart for caret placement, reordering and run borders.
 *
 * Returns null when the parts do not map one to one onto increasing passages, or when a line
 * that broke in physical x holds fewer than two parts.
 */
export function alignBidiPassageSpans(
  spans: readonly StyleSpanRecord[],
  passages: readonly LinePassage[],
  alignPart: AlignPart
): readonly StyleSpanRecord[] | null {
  const mirrored = passages[0]?.breakStart !== undefined;
  const parts = passageParts(spans);
  if (parts.length === 0 || (!mirrored && parts.length < 2)) return null;
  const owners = passageOwners(parts, passages);
  if (!owners) return null;
  const aligned: StyleSpanRecord[] = [];
  let previous: { readonly left: number; readonly right: number } | undefined;
  for (const [index, part] of parts.entries()) {
    const passage = owners[index]!;
    const shift = passage.breakStart === undefined ? 0 : passage.start - passage.breakStart;
    const moved =
      shift === 0
        ? part
        : part.map((span) => ({ ...span, box: { ...span.box, x: span.box.x + shift } }));
    const placed = alignPart(moved, passage, index === parts.length - 1);
    if (placed.length === 0) continue;
    let left = Infinity;
    let right = -Infinity;
    for (const span of placed) {
      left = Math.min(left, span.box.x);
      right = Math.max(right, span.box.x + span.box.width);
    }
    const [first, ...rest] = placed;
    const { wrapAdvanceBefore: _old, ...own } = first!;
    const gap = previous ? (mirrored ? previous.left - right : left - previous.right) : 0;
    aligned.push(gap > 0.001 ? { ...own, wrapAdvanceBefore: gap } : own, ...rest);
    previous = { left, right };
  }
  return aligned;
}

/** Where a part's content ends, measured from its passage's start: its last span's far edge. */
export function partUsedWidth(part: readonly StyleSpanRecord[], passage: LinePassage): number {
  const last = part[part.length - 1]!;
  return last.box.x + last.box.width - passage.start;
}

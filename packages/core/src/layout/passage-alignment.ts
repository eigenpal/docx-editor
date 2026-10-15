import type { StyleSpanRecord } from './semantic-records.ts';

/** A float passage of one line, in the same x space as the line's spans. */
export interface LinePassage {
  readonly start: number;
  readonly end: number;
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
  alignPart: (
    part: readonly StyleSpanRecord[],
    passage: LinePassage,
    isLastPart: boolean
  ) => readonly StyleSpanRecord[]
): readonly StyleSpanRecord[] | null {
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
  if (parts.length < 2) return null;
  let previousPassage = -1;
  const owners: LinePassage[] = [];
  for (const part of parts) {
    const x = part[0]!.box.x;
    let owner = -1;
    for (let index = passages.length - 1; index >= 0; index -= 1) {
      if (passages[index]!.start <= x + 0.001) {
        owner = index;
        break;
      }
    }
    if (owner <= previousPassage) return null;
    previousPassage = owner;
    owners.push(passages[owner]!);
  }
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

/** Where a part's content ends, measured from its passage's start: its last span's far edge. */
export function partUsedWidth(part: readonly StyleSpanRecord[], passage: LinePassage): number {
  const last = part[part.length - 1]!;
  return last.box.x + last.box.width - passage.start;
}

// A composition's edit, carried onto a paragraph that changed while it was being composed.
//
// The painted DOM belongs to the input method from `compositionstart` to `compositionend`,
// so the surface holds its repaint for that long (see `render` in paginated-surface.ts). The
// MODEL does not wait: a collaborator's edit arriving mid-composition is applied at once. At
// `compositionend` the page therefore shows the paragraph as it was when the composition
// began, plus what the input method wrote, while the model holds that older text plus the
// collaborator's edit. Diffing the two would read the collaborator's edit as the user's, and
// undo it.
//
// So the readback is taken against the text the composition began over (`base`), which is
// what the page shows, and the one edit that yields is moved onto the model's current text.
// Where both edits touch the same characters, the collaborator's are kept: the composed text
// is inserted beside them and never deletes what the user did not see.

/** One replace, in the offsets of the text it applies to. */
interface TextEdit {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

/** The differing middle of two strings: `before.slice(start, end)` became `text`. */
function differingMiddle(before: string, after: string): TextEdit {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) {
    start += 1;
  }
  let suffix = 0;
  while (
    suffix < before.length - start &&
    suffix < after.length - start &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  return { start, end: before.length - suffix, text: after.slice(start, after.length - suffix) };
}

/**
 * What the input method did to `base`.
 *
 * A composition at a collapsed caret inserts there, which a plain diff cannot always tell:
 * `에` composed before `에서` diffs as an insert after it. When the caret's reading gives the
 * same text, it is the one taken, so the edit keeps its side of the remote text.
 */
function composedEdit(base: string, painted: string, caret: number | null): TextEdit {
  const grown = painted.length - base.length;
  if (
    caret !== null &&
    grown > 0 &&
    caret <= base.length &&
    painted.startsWith(base.slice(0, caret)) &&
    painted.endsWith(base.slice(caret))
  ) {
    return { start: caret, end: caret, text: painted.slice(caret, caret + grown) };
  }
  return differingMiddle(base, painted);
}

/**
 * Where an offset into `base` is in `current`.
 *
 * Before the changed middle it stays, after it it moves by the change in length, and inside
 * it — characters the collaborator replaced — it goes to the start of their replacement.
 */
export function rebaseOffset(base: string, current: string, offset: number): number {
  if (base === current) return offset;
  const remote = differingMiddle(base, current);
  if (offset <= remote.start) return offset;
  if (offset >= remote.end) return offset + current.length - base.length;
  return remote.start;
}

/**
 * The text a paragraph should hold: `current` with the input method's edit applied.
 *
 * `base` is the text the composition began over, `painted` what the page shows at its end,
 * and `caret` the collapsed caret offset it began at, or null for a range.
 */
export function rebaseComposedText(
  base: string,
  painted: string,
  current: string,
  caret: number | null
): string {
  if (current === base) return painted;
  if (painted === base) return current;
  const edit = composedEdit(base, painted, caret);
  const remote = differingMiddle(base, current);
  // Clear of the collaborator's change on either side: the edit applies as it was made.
  if (edit.end <= remote.start) {
    return current.slice(0, edit.start) + edit.text + current.slice(edit.end);
  }
  const shift = current.length - base.length;
  if (edit.start >= remote.end) {
    return current.slice(0, edit.start + shift) + edit.text + current.slice(edit.end + shift);
  }
  // Overlapping: the collaborator's text stays whole, the composed text goes in front of it,
  // and only characters that both sides still had are deleted.
  const head = Math.min(edit.start, remote.start);
  const tail = Math.max(edit.end, remote.end);
  return base.slice(0, head) + edit.text + remote.text + base.slice(tail);
}

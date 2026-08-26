// The `\#` numeric picture switch, for the page fields the engine already evaluates.
//
// A cached field result is whatever the authoring application last painted, so a file that was
// saved at three pages carries `03` in every copy of its `PAGE \# 0#` field. Painting that
// cache puts a stale number on every sheet. The value is computable, so compute it — and then
// the picture has to be applied, or a field authored as `0#` paints `2` where Word paints `02`.
//
// Deliberately a SUBSET, because the input is attacker-controlled: digit placeholders, a
// grouping comma and literal characters. No expression evaluation, no negative subpicture, no
// locale lookup, and a hard cap on the picture length. Anything this cannot express falls back
// to plain decimal rather than to the cached text.

/** Longest picture this evaluates; longer pictures fall back to decimal. */
export const MAX_NUMERIC_PICTURE_CHARS = 64;

/**
 * Render a non-negative integer through a `\#` picture, or null when the picture states no
 * digit position at all (caller falls back to plain decimal).
 *
 * Positions fill from the right, exactly as Word aligns a picture against a value:
 *
 *   - `0` — a digit position that is always shown; an unfilled one paints `0`.
 *   - `#` — a digit position shown only when a digit reaches it.
 *   - `,` — a grouping separator, painted only when a digit still remains to its left.
 *   - anything else — a literal, painted as authored.
 *
 * A value with more digits than the picture has positions keeps every digit: the overflow is
 * painted at the leftmost position rather than truncated, because a page number that silently
 * loses its leading digit is worse than one that ignores its picture.
 */
export function formatNumericPicture(value: number, picture: string): string | null {
  if (!Number.isFinite(value) || value < 0) return null;
  if (picture.length === 0 || picture.length > MAX_NUMERIC_PICTURE_CHARS) return null;
  const digits = String(Math.floor(value));
  let remaining = digits.length;
  let sawPosition = false;
  const out: string[] = [];
  for (let index = picture.length - 1; index >= 0; index -= 1) {
    const glyph = picture[index]!;
    if (glyph === '0' || glyph === '#') {
      sawPosition = true;
      if (remaining > 0) {
        remaining -= 1;
        out.push(digits[remaining]!);
      } else if (glyph === '0') {
        out.push('0');
      }
      continue;
    }
    if (glyph === ',') {
      if (remaining > 0) out.push(',');
      continue;
    }
    out.push(glyph);
  }
  if (!sawPosition) return null;
  if (remaining > 0) out.push(digits.slice(0, remaining));
  return out.reverse().join('');
}

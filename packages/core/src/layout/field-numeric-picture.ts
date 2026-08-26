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
 *   - `#` — a digit position; an unfilled one paints a SPACE, which is what Word does
 *     (`{ = 9 + 6 \# $### }` renders `$ 15`) and what keeps every value the field can hold
 *     the same width as the placeholder it was measured at.
 *   - `,` — a grouping separator, painted only when a digit still remains to its left.
 *   - anything else — a literal, painted as authored.
 *
 * A value with more digits than the picture has positions keeps every digit: the overflow is
 * painted at the leftmost position rather than truncated, because a page number that silently
 * loses its leading digit is worse than one that ignores its picture. Overflow digits keep the
 * picture's grouping — `1234567` through `#,###` is `1,234,567`, as Word renders it, not
 * `1234,567` — by repeating the interval the picture's last separator established.
 *
 * A picture with a DECIMAL POINT is refused rather than misread. `0.00` splits into integral
 * and fractional positions that fill in opposite directions, and this fills strictly from the
 * right, so it would render 3 as `0.03` where Word renders `3.00`. Page counts are integers,
 * so the plain number the caller falls back to is the right answer anyway.
 */
export function formatNumericPicture(value: number, picture: string): string | null {
  if (!Number.isFinite(value) || value < 0) return null;
  if (picture.length === 0 || picture.length > MAX_NUMERIC_PICTURE_CHARS) return null;
  if (picture.includes('.')) return null;
  const digits = String(Math.floor(value));
  let remaining = digits.length;
  let sawPosition = false;
  /** Digit positions since the picture's last `,`, which sets the group width for overflow. */
  let sinceGroup = 0;
  let groupWidth = 0;
  const out: string[] = [];
  for (let index = picture.length - 1; index >= 0; index -= 1) {
    const glyph = picture[index]!;
    if (glyph === '0' || glyph === '#') {
      sawPosition = true;
      sinceGroup += 1;
      if (remaining > 0) {
        remaining -= 1;
        out.push(digits[remaining]!);
      } else {
        out.push(glyph === '0' ? '0' : ' ');
      }
      continue;
    }
    if (glyph === ',') {
      // The first separator the walk meets fixes the interval every overflow group repeats.
      if (groupWidth === 0) groupWidth = sinceGroup;
      sinceGroup = 0;
      if (remaining > 0) out.push(',');
      continue;
    }
    out.push(glyph);
  }
  if (!sawPosition) return null;
  // Digits the picture had no position for. They keep its grouping, so a value wider than the
  // picture reads the way the picture said narrower ones would.
  while (remaining > 0) {
    if (groupWidth > 0 && sinceGroup >= groupWidth) {
      out.push(',');
      sinceGroup = 0;
    }
    remaining -= 1;
    sinceGroup += 1;
    out.push(digits[remaining]!);
  }
  return out.reverse().join('');
}

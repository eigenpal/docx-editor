// CJK line-break opportunities (UAX #14, minimal ideographic form).
//
// Latin scripts break at spaces, so `wordBoundaries` in `paragraph-flow.ts` only cut after
// spaces, dashes and tabs. CJK prose carries no spaces at all: a Chinese clause was one
// giant "word", wrapped only through the wider-than-empty-line chop, and any run or piece
// seam inside it became the only place a line could end (#526). UAX #14 gives ideographic
// characters (class ID) a break opportunity on BOTH sides instead, subject to the kinsoku
// prohibitions: a line must not START with a closing character (。，、」…) and must not END
// with an opening one (「（…).
//
// Scope is deliberately the ideographic classes only — Han, Kana, CJK symbols and
// punctuation, compatibility ideographs, and the full-width forms. A break between an
// ideograph and Latin/digit text (UAX #14 allows one) is NOT introduced, so every existing
// Latin break decision stays byte-identical and "1." stays glued to the 甲 that follows it.
// Hangul, JIS kinsoku levels and other tailorings are out of scope.

/**
 * Whether the code point takes ideographic line breaking — a break opportunity on both
 * sides, before the kinsoku sets below veto one direction.
 *
 * Ranges: CJK radicals/Kangxi through symbols-and-punctuation and Kana (U+2E80–U+312F),
 * strokes/Katakana-ext through the unified block (U+31C0–U+9FFF), compatibility ideographs
 * (U+F900–U+FAFF), vertical/compat forms (U+FE30–U+FE4F), full- and half-width forms
 * (U+FF01–U+FF65), and the supplementary ideographic planes (U+20000–U+3134F).
 */
export function isIdeographicForLineBreak(codePoint: number): boolean {
  return (
    (codePoint >= 0x2e80 && codePoint <= 0x312f) ||
    (codePoint >= 0x31c0 && codePoint <= 0x9fff) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe4f) ||
    (codePoint >= 0xff01 && codePoint <= 0xff65) ||
    (codePoint >= 0x20000 && codePoint <= 0x3134f)
  );
}

const codePointsOf = (text: string): ReadonlySet<number> =>
  new Set([...text].map((ch) => ch.codePointAt(0)!));

/**
 * Characters a line must not START with (kinsoku 行頭禁則): closing brackets and quotes,
 * CJK full stops and commas (their half-width forms too), sentence-final marks, iteration
 * and prolonged-sound marks, small kana, and unit/percent signs that trail a figure.
 * Everything here is outside ASCII, so Latin layout cannot observe the set.
 */
export const CJK_NO_BREAK_BEFORE: ReadonlySet<number> = codePointsOf(
  '。．，、；：？！」』）】〉》〕〗〙〛｝］＞％' +
    '｡｣､･ｰ' +
    '々〜ゝゞヽヾー' +
    'ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ' +
    '‰′″℃'
);

/**
 * Characters a line must not END with (kinsoku 行末禁則): opening brackets and quotes,
 * and currency signs that prefix a figure. Also entirely outside ASCII.
 */
export const CJK_NO_BREAK_AFTER: ReadonlySet<number> =
  codePointsOf('「『（【〈《〔〖〘〚｛［＜｢＄￥');

/**
 * Whether a line may break between these two adjacent code points.
 *
 * Both sides must be ideographic — the minimal-scope rule above — and neither kinsoku set
 * may veto its direction. The closing and opening characters are themselves inside the
 * ideographic ranges, so 「 glues to the character after it and 。 to the one before,
 * while both still break freely on their permitted side.
 */
export function cjkBreakAllowedBetween(before: number, after: number): boolean {
  if (!isIdeographicForLineBreak(before) || !isIdeographicForLineBreak(after)) return false;
  if (CJK_NO_BREAK_AFTER.has(before)) return false;
  if (CJK_NO_BREAK_BEFORE.has(after)) return false;
  return true;
}

/** The final code point of the text, stepping back over a surrogate pair; undefined when empty. */
export function lastCodePointOf(text: string): number | undefined {
  if (text.length === 0) return undefined;
  const lastUnit = text.charCodeAt(text.length - 1);
  if (lastUnit >= 0xdc00 && lastUnit <= 0xdfff && text.length >= 2) {
    return text.codePointAt(text.length - 2)!;
  }
  return lastUnit;
}

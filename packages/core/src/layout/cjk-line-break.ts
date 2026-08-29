// Line-break opportunities: Latin word boundaries and CJK ideographic breaking
// (UAX #14, minimal ideographic form).
//
// Latin scripts break at spaces, dashes and tabs — `wordBoundaries` below. CJK prose
// carries no spaces at all: a Chinese clause was one giant "word", wrapped only through
// the wider-than-empty-line chop, and any run or piece seam inside it became the only
// place a line could end (#526). UAX #14 gives ideographic characters (class ID) a break
// opportunity on BOTH sides instead, subject to the kinsoku prohibitions: a line must not
// START with a closing character (。，、」…) and must not END with an opening one (「（…).
//
// Scope is deliberately the ideographic classes only — Han, Kana (half-width forms
// included), CJK symbols and punctuation, compatibility ideographs, and the full-width
// forms. A break between an ideograph and Latin/digit text (UAX #14 allows one) is NOT
// introduced, so every existing Latin break decision stays byte-identical and "1." stays
// glued to the 甲 that follows it. Named cuts, so the follow-ups stay discoverable:
//
// - Full-width digits and letters sit inside the ideographic ranges, so a figure group
//   such as ０．５ can split across lines where Word keeps it together.
// - The kinsoku sets carry the ideographic-class subset only. Word's East Asian tables
//   also veto ASCII and Latin-1 punctuation (!%,.:;?°′″℃) at a line start, but only in
//   East Asian context — honouring that needs script itemization these boundaries do not
//   see, and vetoing unconditionally changes pure-Latin wrapping.
// - Justification still stretches only trailing spaces. A justified CJK paragraph
//   (`w:jc` set to `both`, the Normal-style default in Chinese and Japanese templates)
//   paints ragged-right on kinsoku-shortened lines where Word distributes
//   inter-character slack.
// - Hangul, JIS kinsoku levels and other tailorings are out of scope.

import { segmentGraphemes } from './grapheme.ts';

/**
 * Whether the code point takes ideographic line breaking — a break opportunity on both
 * sides, before the kinsoku sets below veto one direction.
 *
 * Ranges: CJK radicals/Kangxi through symbols-and-punctuation and Kana (U+2E80–U+312F),
 * strokes/Katakana-ext through the unified block (U+31C0–U+9FFF), compatibility ideographs
 * (U+F900–U+FAFF), vertical/compat forms (U+FE30–U+FE4F), full-width forms and half-width
 * Katakana (U+FF01–U+FF9F), and the supplementary ideographic planes (U+20000–U+3134F).
 */
export function isIdeographicForLineBreak(codePoint: number): boolean {
  return (
    (codePoint >= 0x2e80 && codePoint <= 0x312f) ||
    (codePoint >= 0x31c0 && codePoint <= 0x9fff) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe4f) ||
    (codePoint >= 0xff01 && codePoint <= 0xff9f) ||
    (codePoint >= 0x20000 && codePoint <= 0x3134f)
  );
}

const codePointsOf = (text: string): ReadonlySet<number> =>
  new Set([...text].map((ch) => ch.codePointAt(0)!));

/**
 * Characters a line must not START with (kinsoku 行頭禁則): closing brackets and quotes,
 * CJK full stops and commas (their half-width forms too), sentence-final marks, the
 * ideographic space and middle dots, iteration and prolonged-sound marks, and small kana
 * (full- and half-width, with the half-width voicing marks that lean on the kana before
 * them). Every member sits at or above the first ideographic code unit, so Latin layout
 * cannot observe these sets.
 */
export const CJK_NO_BREAK_BEFORE: ReadonlySet<number> = codePointsOf(
  '。．，、；：？！」』）】〉》〕〗〙〛｝］＞％　・' +
    '｡｣､･ｰﾞﾟ' +
    '々〜ゝゞヽヾー' +
    'ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ' +
    'ｧｨｩｪｫｬｭｮｯ'
);

/**
 * Characters a line must not END with (kinsoku 行末禁則): opening brackets and quotes,
 * and currency signs that prefix a figure. Also entirely above the Latin range.
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

/**
 * Dashes a line may break AFTER, the way Word wraps "ALPHA-PRIME" as "ALPHA-" / "PRIME":
 * hyphen-minus, hyphen, en dash, em dash. U+2011 NON-BREAKING HYPHEN is deliberately
 * absent — its whole meaning is "no wrap here".
 */
export const BREAK_AFTER_DASH: ReadonlySet<string> = new Set(['-', '‐', '–', '—']);

/** Every kinsoku member and every ideographic range sits at or above this code unit. */
const FIRST_IDEOGRAPHIC_UNIT = 0x2e80;

/**
 * UTF-16 positions where a grapheme cluster starts, for vetoing a cut inside one.
 *
 * Built lazily: the Latin boundary rules cut beside spaces, tabs and dashes, which are
 * cluster boundaries by construction, so only the ideographic pass pays for segmentation —
 * once per text, and only when it found a break to check. The oversized-word chop steps by
 * cluster already, so it needs only the kinsoku half (`cjkChopCutAllowedAt`).
 */
function clusterCutTester(text: string): (position: number) => boolean {
  let starts: Set<number> | null = null;
  return (position: number): boolean => {
    if (starts === null) {
      starts = new Set();
      for (const segment of segmentGraphemes(text)) starts.add(segment.utf16From);
      starts.add(text.length);
    }
    return starts.has(position);
  };
}

/** Merge two strictly-increasing, disjoint boundary lists. */
function mergeBoundaries(latin: readonly number[], cjk: readonly number[]): number[] {
  const merged: number[] = [];
  let latinAt = 0;
  let cjkAt = 0;
  while (latinAt < latin.length || cjkAt < cjk.length) {
    const nextLatin = latinAt < latin.length ? latin[latinAt]! : Number.POSITIVE_INFINITY;
    const nextCjk = cjkAt < cjk.length ? cjk[cjkAt]! : Number.POSITIVE_INFINITY;
    if (nextLatin < nextCjk) {
      merged.push(nextLatin);
      latinAt += 1;
    } else {
      merged.push(nextCjk);
      cjkAt += 1;
    }
  }
  return merged;
}

/**
 * Break points inside a piece: after each run of spaces (words stay whole), after a dash
 * that sits between non-space text, with each tab as its own atom so tab-stop geometry can
 * size `\t` independently of neighbouring text — and, when `ideographic` allows it,
 * between ideographic characters, where UAX #14 allows a line to end (kinsoku vetoes
 * aside). Layout-owned pieces pass `ideographic: false`: every span they emit publishes
 * the piece's whole model range, so they are documented as staying whole, and a
 * per-ideograph split would wrap a field result mid-text with every line claiming the
 * same range.
 *
 * A dash run breaks only after its LAST dash, mirroring how a run of spaces is one
 * boundary; a dash beside a space adds nothing the space boundary does not already give.
 */
export function wordBoundaries(text: string, ideographic: boolean): number[] {
  const boundaries: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const ch = text[index]!;
    if (ch === '\t') {
      if (index > 0 && boundaries[boundaries.length - 1] !== index) boundaries.push(index);
      boundaries.push(index + 1);
    } else if (ch === ' ') {
      boundaries.push(index + 1);
    } else if (
      BREAK_AFTER_DASH.has(ch) &&
      index > 0 &&
      text[index - 1] !== ' ' &&
      index + 1 < text.length &&
      text[index + 1] !== ' ' &&
      !BREAK_AFTER_DASH.has(text[index + 1]!)
    ) {
      boundaries.push(index + 1);
    }
  }
  // CJK pass, by code point so a supplementary-plane ideograph is never cut inside its
  // surrogate pair, filtered through the grapheme boundary so NFD text (か + U+3099) is
  // never cut inside a cluster either. Kept separate from the loop above so the Latin
  // rules stay byte-identical; both lists are strictly increasing and can never share a
  // position (every Latin cut borders a space, tab or dash, none of which is
  // ideographic), so an O(n) merge replaces them without a sort.
  let merged = boundaries;
  if (ideographic) {
    const cjk: number[] = [];
    const clusterCutAt = clusterCutTester(text);
    for (let index = 0; index < text.length; ) {
      const before = text.codePointAt(index)!;
      const next = index + (before > 0xffff ? 2 : 1);
      if (next >= text.length) break;
      if (cjkBreakAllowedBetween(before, text.codePointAt(next)!) && clusterCutAt(next)) {
        cjk.push(next);
      }
      index = next;
    }
    if (cjk.length > 0) merged = mergeBoundaries(boundaries, cjk);
  }
  if (merged[merged.length - 1] !== text.length) merged.push(text.length);
  return merged;
}

/** Whether a cut between two adjacent code points is legal under the kinsoku sets. */
export function cjkCutAllowedBetween(
  before: number | undefined,
  after: number | undefined
): boolean {
  if (after !== undefined && CJK_NO_BREAK_BEFORE.has(after)) return false;
  if (before !== undefined && CJK_NO_BREAK_AFTER.has(before)) return false;
  return true;
}

/**
 * Whether the oversized-word chop may cut `text` at `index`.
 *
 * The chop measures a fit length that knows nothing about kinsoku — at a one-character
 * measure 天。地。人。 rendered every other line starting with 。 —  and
 * `chopOversizedWord` walks the cut to the nearest position this accepts. Grapheme and
 * surrogate safety is the chop's own (it steps by cluster), so only the kinsoku sets are
 * asked here.
 */
export function cjkChopCutAllowedAt(text: string, index: number): boolean {
  if (index <= 0 || index >= text.length) return true;
  return cjkCutAllowedBetween(lastCodePointOf(text.slice(0, index)), text.codePointAt(index));
}

/**
 * Whether a candidate may OPEN a line — the decision the placement loop and the
 * anchor-line probe must share, or their predicted line starts diverge.
 *
 * A candidate is a break opportunity at any `wordBoundaries` cut inside its piece
 * (`afterIntraPieceCut`). The FIRST candidate of a piece continues whatever the previous
 * piece ended with, so it is one only if that ended in whitespace — or in a dash or an
 * ideograph, which stay break opportunities across run boundaries (a tracked change can
 * split "ALPHA-" and "PRIME" into different runs without gluing them, and a CJK clause
 * split across runs must not wrap at the seam instead of the margin, #526). The kinsoku
 * sets then veto the whole decision: no opportunity ever puts 。，、」 at a line start or
 * leaves 「（ at a line end — a space or a run seam directly before a closing mark would
 * otherwise create one. A tab outranks the veto: a tab is a hard break opportunity whose
 * following text must be able to open a line, or an overflow takes the mid-word carry
 * path and re-lays the tab with a stale advance that no longer reaches its stop.
 */
export function wordOpensAt(
  lastEmitted: string,
  candidate: string,
  afterIntraPieceCut: boolean
): boolean {
  const opportunity =
    afterIntraPieceCut ||
    lastEmitted === '' ||
    /[\s ]$/.test(lastEmitted) ||
    /^[\s ]/.test(candidate) ||
    (BREAK_AFTER_DASH.has(lastEmitted[lastEmitted.length - 1]!) &&
      !BREAK_AFTER_DASH.has(candidate[0]!));
  // Both seam units below the first ideographic range: no CJK rule can observe the seam,
  // so the pre-ideographic decision above is final. This is the hot path for pure-Latin
  // text — no decode, no set lookups. (A surrogate unit is above the threshold.)
  const lastUnit = lastEmitted.length === 0 ? 0 : lastEmitted.charCodeAt(lastEmitted.length - 1);
  if (lastUnit < FIRST_IDEOGRAPHIC_UNIT && candidate.charCodeAt(0) < FIRST_IDEOGRAPHIC_UNIT) {
    return opportunity;
  }
  if (lastUnit === 0x09) return true;
  const previous = lastCodePointOf(lastEmitted);
  const first = candidate.codePointAt(0)!;
  return (
    (opportunity || (previous !== undefined && cjkBreakAllowedBetween(previous, first))) &&
    cjkCutAllowedBetween(previous, first)
  );
}

// Dictionary word-break opportunities for scripts written without spaces between words.
//
// Thai, Lao, Khmer, and Myanmar text separates phrases, not words, with spaces, so the
// space and dash rules in `cjk-line-break.ts` see a whole clause as one unbreakable word.
// UAX #14 gives these letters line-break class SA (complex context): a line may end only
// at a word boundary that a dictionary finds. `Intl.Segmenter` with word granularity is
// that dictionary, through the same invariant locale as word selection (`word-segment.ts`).
//
// The analysis works on paragraph text, never on one source run, so a formatting or
// revision seam inside a word adds no break and removes none. Paragraph break analysis
// (`cjk-paragraph-breaks.ts`) and table AutoFit minimums (`table-autofit-widths.ts`) read
// the same cuts, so a dictionary word is the unit that both wrap and size a column by.
//
// Runtime requirement: `Intl.Segmenter` with ICU dictionary data for the script. Each
// script is probed once with a known phrase. Where the constructor is absent, or the probe
// does not find dictionary words, that script gets no cuts and keeps the space, dash, and
// zero-width-space rules. That covers Node.js built with `small-icu` or without Intl, React
// Native on Hermes, and per-character polyfills. Break positions come from the runtime's
// ICU dictionaries, so they can differ between ICU versions; layout is deterministic for
// one runtime, not across runtimes.

import { CJK_NO_BREAK_BEFORE, clusterBreaksBetween, isStackingSign } from './cjk-line-break.ts';
import { graphemeBoundaryEpoch, segmentGraphemes } from './grapheme.ts';
import { createIntlWordBoundary, isIntlWordSegmenterAvailable } from './word-segment.ts';

/**
 * The scripts that take dictionary word breaks.
 * @public
 */
export type DictionaryScript = 'thai' | 'lao' | 'khmer' | 'myanmar';

/**
 * The script of a code point with line-break class SA, or null for every other code point.
 *
 * Letters, vowel signs, tone marks, and the repetition and abbreviation signs of each script
 * are SA. Digits (class NU) and the scripts' own sentence punctuation (class BA) are not, so
 * they end a dictionary run and keep their ordinary break rules.
 */
export function dictionaryScriptOf(cp: number): DictionaryScript | null {
  if (cp < 0x0e01) return null;
  if (cp <= 0x0e3a || (cp >= 0x0e40 && cp <= 0x0e4e)) return 'thai';
  if (cp >= 0x0e81 && cp <= 0x0edf) return cp >= 0x0ed0 && cp <= 0x0ed9 ? null : 'lao';
  if (cp >= 0x1000 && cp <= 0x109f) {
    if ((cp >= 0x1040 && cp <= 0x104f) || (cp >= 0x1090 && cp <= 0x1099)) return null;
    return 'myanmar';
  }
  if (cp >= 0x1780 && cp <= 0x17dd) {
    return cp <= 0x17d3 || cp === 0x17d7 || cp >= 0x17dc ? 'khmer' : null;
  }
  if ((cp >= 0xa9e0 && cp <= 0xa9ef) || (cp >= 0xa9fa && cp <= 0xa9fe)) return 'myanmar';
  if (cp >= 0xaa60 && cp <= 0xaa7f) return 'myanmar';
  return null;
}

/**
 * The script of a phrase or sentence mark with line-break class BA (break after): Thai
 * U+0E5A–U+0E5B, Khmer U+17D4–U+17D5, U+17D8, U+17DA, and Myanmar U+104A–U+104B.
 */
export function breakAfterSignScript(cp: number): DictionaryScript | null {
  if (cp === 0x0e5a || cp === 0x0e5b) return 'thai';
  if (cp === 0x17d4 || cp === 0x17d5 || cp === 0x17d8 || cp === 0x17da) return 'khmer';
  if (cp === 0x104a || cp === 0x104b) return 'myanmar';
  return null;
}

/**
 * Characters that cannot start a line after a sentence mark (UAX #14): closing punctuation
 * (CL, CP), quotation marks (QU), `!` and `?` (EX), infix separators (IS), `/` (SY), hyphens
 * (HY), combining marks and the zero-width joiner (CM), word joiners (WJ), no-break
 * characters (GL), the Khmer sign U+17D6 (NS), and the Thai vowels that follow a consonant
 * (U+0E30, U+0E32, U+0E33, U+0E45). Spaces and zero-width spaces break after themselves
 * instead, and so does another sentence mark.
 */
const NO_LINE_START_AFTER_SIGN =
  /^[\p{M}\p{Pe}\p{Pf}\p{Pi}"'!?,.:;/\-\u00a0\u034f\u2007\u2011\u202f\u200b\u200d\u2060\ufeff \u17d6\u0e30\u0e32\u0e33\u0e45]$/u;

/**
 * Whether a line may break between a Khmer, Myanmar, or Thai sentence mark (class BA) and
 * the code point after it: only when that script has dictionary support, and the next code
 * point may start a line. The one rule both line breaking and table AutoFit use.
 */
export function breaksAfterSign(sign: number, next: number): boolean {
  const script = breakAfterSignScript(sign);
  if (script === null || breakAfterSignScript(next) !== null) return false;
  if (CJK_NO_BREAK_BEFORE.has(next)) return false;
  if (NO_LINE_START_AFTER_SIGN.test(String.fromCodePoint(next))) return false;
  return isDictionaryWordBreakSupported(script);
}

/**
 * A cheap prefilter: whether the text can hold any character of the dictionary scripts'
 * blocks (letters, marks, digits, or sentence marks).
 */
const DICTIONARY_SCRIPT_TEXT =
  /[\u0e01-\u0e5b\u0e81-\u0edf\u1000-\u109f\u1780-\u17dd\ua9e0-\ua9fe\uaa60-\uaa7f]/u;

/** Whether the text holds a character of a dictionary script's block. */
export function hasDictionaryScriptText(text: string): boolean {
  return DICTIONARY_SCRIPT_TEXT.test(text);
}

/**
 * A dictionary word segmenter: the interior word boundaries of one single-script run of Thai,
 * Lao, Khmer, or Myanmar letters, as strictly increasing UTF-16 offsets inside
 * `(0, run.length)`. Offsets outside that range, out of order, or inside a grapheme cluster
 * are ignored. A segmenter that throws gives that run no boundaries.
 * @public
 */
export type DictionaryWordSegmenter = (run: string) => readonly number[];

/** Phrases with known word boundaries, one per script, for the runtime probe. */
const PROBES: Readonly<Record<DictionaryScript, string>> = {
  thai: 'ฉันอยากกินข้าว',
  lao: 'ພາສາລາວເປັນ',
  khmer: 'ភាសាខ្មែរគឺជាភាសា',
  myanmar: 'မြန်မာဘာသာစကား',
};

/**
 * Runs longer than this are segmented in overlapping windows, so one file-supplied run never
 * becomes one unbounded segmenter call.
 */
const WINDOW_UNITS = 2048;
/** Boundaries this close to a window's end are re-found by the next window, with context. */
const WINDOW_MARGIN_UNITS = 64;
/** The most text one paragraph sends through the segmenter; later runs keep the space rules. */
const MAX_PARAGRAPH_UNITS = 65_536;
/** Only runs up to this length are cached; the cache is cleared when it fills. */
const MAX_CACHED_RUN_UNITS = 512;
const MAX_CACHED_RUNS = 4096;
/** Paragraph texts up to this length keep their cuts, as runs do, in a bounded cache. */
const MAX_CACHED_TEXT_UNITS = 8192;
const MAX_CACHED_TEXTS = 256;

function intlSegmenter(): DictionaryWordSegmenter | null {
  if (!isIntlWordSegmenterAvailable()) return null;
  let boundary: ReturnType<typeof createIntlWordBoundary>;
  try {
    boundary = createIntlWordBoundary();
  } catch {
    return null;
  }
  return (run) => {
    const cuts: number[] = [];
    for (const segment of boundary.segment(run)) {
      if (segment.utf16From > 0 && segment.utf16From < run.length) cuts.push(segment.utf16From);
    }
    return cuts;
  };
}

let override: DictionaryWordSegmenter | null | undefined;
let defaultSegmenter: DictionaryWordSegmenter | null | undefined;
let support: Partial<Record<DictionaryScript, boolean>> = {};
const runCache = new Map<string, readonly number[]>();
const textCache = new Map<string, readonly number[]>();
let segmenterEpoch = 0;
let cachedGraphemeEpoch = -1;

/**
 * Install the dictionary word segmenter that line breaking and table AutoFit use, for a
 * runtime whose `Intl.Segmenter` lacks dictionary data (React Native on Hermes, or Node.js
 * built with `small-icu`). `null` turns dictionary word breaks off: these scripts then wrap
 * only at spaces, zero-width spaces, and dashes.
 *
 * Install it before you create editors. A change takes effect at the next layout pass: layout
 * sessions and paragraph break caches key on the segmenter generation, so that pass re-breaks
 * text instead of serving lines cached under the previous segmenter. An editor that is
 * already open does not lay out again on its own; it shows the new breaks after its next
 * layout, such as the one an edit causes. Each script is probed again through the new
 * segmenter. Call {@link resetDictionaryWordSegmenter} to restore `Intl.Segmenter`.
 * @public
 */
export function setDictionaryWordSegmenter(segmenter: DictionaryWordSegmenter | null): void {
  override = segmenter;
  segmenterEpoch += 1;
  clearCaches();
}

/**
 * Restore the default dictionary word segmenter, `Intl.Segmenter` at the invariant locale.
 * @public
 */
export function resetDictionaryWordSegmenter(): void {
  override = undefined;
  segmenterEpoch += 1;
  clearCaches();
}

/**
 * Bumped by {@link setDictionaryWordSegmenter} and {@link resetDictionaryWordSegmenter}. The
 * pass producer folds it in, so paragraph break caches and layout sessions re-break text
 * under the new segmenter instead of serving lines from the old one.
 */
export function dictionaryWordSegmenterEpoch(): number {
  return segmenterEpoch;
}

function clearCaches(): void {
  support = {};
  runCache.clear();
  textCache.clear();
}

/**
 * Probe results and cached cuts depend on the grapheme boundary too (the probe counts
 * clusters, cuts are filtered by them), so a boundary change drops them.
 */
function syncGraphemeEpoch(): void {
  const epoch = graphemeBoundaryEpoch();
  if (epoch === cachedGraphemeEpoch) return;
  cachedGraphemeEpoch = epoch;
  clearCaches();
}

function activeSegmenter(): DictionaryWordSegmenter | null {
  if (override !== undefined) return override;
  if (defaultSegmenter === undefined) defaultSegmenter = intlSegmenter();
  return defaultSegmenter;
}

/**
 * Whether line breaking and table AutoFit find dictionary words in the script.
 *
 * True when the active segmenter splits a known phrase into at least two words and into fewer
 * words than it has user-perceived characters, so a per-character fallback does not count.
 * When false, text in the script wraps only at spaces, zero-width spaces, and dashes. The
 * result is probed once per script and segmenter.
 * @public
 */
export function isDictionaryWordBreakSupported(script: DictionaryScript): boolean {
  syncGraphemeEpoch();
  const known = support[script];
  if (known !== undefined) return known;
  const segmenter = activeSegmenter();
  let supported = false;
  if (segmenter) {
    const probe = PROBES[script];
    try {
      const cuts = segmenter(probe);
      supported = cuts.length >= 1 && cuts.length + 1 < segmentGraphemes(probe).length;
    } catch {
      supported = false;
    }
  }
  support[script] = supported;
  return supported;
}

const NO_CUTS: readonly number[] = [];

/** Interior cuts of one run, windowed so the cost per call stays bounded. */
function cutsOfRun(run: string, segmenter: DictionaryWordSegmenter): readonly number[] {
  const cacheable = run.length <= MAX_CACHED_RUN_UNITS;
  if (cacheable) {
    const cached = runCache.get(run);
    if (cached) return cached;
  }
  const cuts: number[] = [];
  let from = 0;
  while (from < run.length) {
    const to = Math.min(run.length, from + WINDOW_UNITS);
    const last = to === run.length;
    let next = to;
    let found: readonly number[];
    try {
      found = segmenter(run.slice(from, to));
    } catch {
      found = NO_CUTS;
    }
    for (const cut of found) {
      const at = from + cut;
      if (!Number.isInteger(at) || at <= from || at >= to) continue;
      // A boundary near a cut-off window end may be an artifact of the missing context.
      if (!last && at > to - WINDOW_MARGIN_UNITS) break;
      if (cuts.length === 0 || at > cuts[cuts.length - 1]!) cuts.push(at);
    }
    if (last) break;
    const lastCut = cuts[cuts.length - 1];
    // Resume at the last trusted word start. A window without one is a single word longer
    // than the window; skip past it without inventing a cut.
    next = lastCut !== undefined && lastCut > from ? lastCut : to - WINDOW_MARGIN_UNITS;
    from = Math.max(from + 1, next);
  }
  if (cacheable) {
    if (runCache.size >= MAX_CACHED_RUNS) runCache.clear();
    runCache.set(run, cuts);
  }
  return cuts;
}

/**
 * Dictionary word-break opportunities in paragraph text: strictly increasing UTF-16 offsets
 * inside `(0, text.length)`, each with a letter of the same dictionary script on both sides
 * and at a grapheme cluster boundary, plus the break after a phrase or sentence mark of these
 * scripts (`៕`, `။`, `๚`) that text follows directly.
 *
 * A cut never separates a base letter from its vowel signs or tone marks, never falls beside
 * a space, digit, punctuation, or other script (those keep their own rules), and never comes
 * from a run the runtime cannot segment. Empty when the text holds no dictionary script.
 */
export function dictionaryWordBreaks(text: string): readonly number[] {
  if (!hasDictionaryScriptText(text)) return NO_CUTS;
  const segmenter = activeSegmenter();
  if (!segmenter) return NO_CUTS;
  syncGraphemeEpoch();
  const cacheable = text.length <= MAX_CACHED_TEXT_UNITS;
  const cached = cacheable ? textCache.get(text) : undefined;
  if (cached) return cached;
  const cuts = paragraphCuts(text, segmenter);
  if (cacheable) {
    if (textCache.size >= MAX_CACHED_TEXTS) textCache.clear();
    textCache.set(text, cuts);
  }
  return cuts;
}

function paragraphCuts(text: string, segmenter: DictionaryWordSegmenter): readonly number[] {
  const out: number[] = [];
  let budget = MAX_PARAGRAPH_UNITS;
  let index = 0;
  while (index < text.length && budget > 0) {
    const unit = text.charCodeAt(index);
    const script = dictionaryScriptOf(unit);
    if (script === null) {
      // A sentence or phrase mark of these scripts (UAX #14 class BA) breaks after itself,
      // unless a space, zero-width space, or another such mark follows and breaks later.
      if (index + 1 < text.length && breaksAfterSign(unit, text.codePointAt(index + 1)!))
        out.push(index + 1);
      index += 1;
      continue;
    }
    // Every dictionary code point is in the BMP, so a run is a plain code-unit range.
    let end = index + 1;
    while (end < text.length && dictionaryScriptOf(text.charCodeAt(end)) === script) end += 1;
    if (end - index > 1 && isDictionaryWordBreakSupported(script)) {
      const length = Math.min(end - index, budget);
      budget -= length;
      for (const cut of cutsOfRun(text.slice(index, index + length), segmenter)) {
        out.push(index + cut);
      }
    }
    index = end;
  }
  if (out.length === 0) return NO_CUTS;
  // The segmenter is replaceable; a cut the active grapheme boundary does not also give is
  // dropped. Clusters in these scripts join by pairwise rules (marks extend the letter before
  // them), so the two code points around a cut decide, without segmenting the whole text.
  return out.filter(
    (cut) =>
      !isStackingSign(text.charCodeAt(cut - 1)) &&
      clusterBreaksBetween(text.charCodeAt(cut - 1), text.charCodeAt(cut))
  );
}

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
// does not find dictionary words (an ICU build without the break dictionaries, or a
// per-character polyfill), that script gets no cuts and keeps the space and dash rules.

import { segmentGraphemes } from './grapheme.ts';
import { createIntlWordBoundary, isIntlWordSegmenterAvailable } from './word-segment.ts';

/** The scripts that take dictionary word breaks. */
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

/** A cheap prefilter: whether the text can hold any dictionary-script letter. */
const DICTIONARY_SCRIPT_TEXT = /[ก-๎ກ-ໟက-႟ក-៝ꧠ-ꧾꩠ-ꩿ]/u;

/** Whether the text holds a letter of a dictionary script. */
export function hasDictionaryScriptText(text: string): boolean {
  return DICTIONARY_SCRIPT_TEXT.test(text);
}

/**
 * The replaceable segmenter: interior word boundaries of one single-script run, as UTF-16
 * offsets into it, strictly increasing and inside `(0, run.length)`.
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

/**
 * Replace the segmenter, for tests. `null` simulates a runtime without `Intl.Segmenter`;
 * `undefined` restores the default. Clears the probe results and the run cache.
 */
export function setDictionaryWordSegmenter(segmenter: DictionaryWordSegmenter | null | undefined) {
  override = segmenter;
  support = {};
  runCache.clear();
}

function activeSegmenter(): DictionaryWordSegmenter | null {
  if (override !== undefined) return override;
  if (defaultSegmenter === undefined) defaultSegmenter = intlSegmenter();
  return defaultSegmenter;
}

/**
 * Whether this runtime finds dictionary words in the script: the probe phrase must split into
 * at least two words, and into fewer words than it has user-perceived characters, so a
 * per-character fallback does not count as dictionary data.
 */
export function dictionaryScriptSupported(script: DictionaryScript): boolean {
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
    for (const cut of segmenter(run.slice(from, to))) {
      const at = from + cut;
      if (at <= from || at >= to) continue;
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

const NO_CUTS: readonly number[] = [];

/**
 * Dictionary word-break opportunities in paragraph text: strictly increasing UTF-16 offsets
 * inside `(0, text.length)`, each with a letter of the same dictionary script on both sides
 * and at a grapheme cluster boundary.
 *
 * A cut never separates a base letter from its vowel signs or tone marks, never falls beside
 * a space, digit, punctuation, or other script (those keep their own rules), and never comes
 * from a run the runtime cannot segment. Empty when the text holds no dictionary script.
 */
export function dictionaryWordBreaks(text: string): readonly number[] {
  if (!hasDictionaryScriptText(text)) return NO_CUTS;
  const segmenter = activeSegmenter();
  if (!segmenter) return NO_CUTS;
  const out: number[] = [];
  let budget = MAX_PARAGRAPH_UNITS;
  let index = 0;
  while (index < text.length && budget > 0) {
    const script = dictionaryScriptOf(text.charCodeAt(index));
    if (script === null) {
      index += 1;
      continue;
    }
    // Every dictionary code point is in the BMP, so a run is a plain code-unit range.
    let end = index + 1;
    while (end < text.length && dictionaryScriptOf(text.charCodeAt(end)) === script) end += 1;
    if (end - index > 1 && dictionaryScriptSupported(script)) {
      const length = Math.min(end - index, budget);
      budget -= length;
      for (const cut of cutsOfRun(text.slice(index, index + length), segmenter)) {
        out.push(index + cut);
      }
    }
    index = end;
  }
  if (out.length === 0) return NO_CUTS;
  // The segmenter is replaceable, and a grapheme cluster can be wider than its rules; a cut
  // the active grapheme boundary does not also give is dropped.
  const clusterStarts = new Set<number>();
  for (const cluster of segmentGraphemes(text)) clusterStarts.add(cluster.utf16From);
  return out.filter((cut) => clusterStarts.has(cut));
}

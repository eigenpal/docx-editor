// Bounded automatic hyphenation for layout (DOM-free).
//
// TeX patterns come from the `hyphen` package, admitted for BCP 47 `en*` and `ru*` only.
// The module never inserts U+00AD into model text: it reports UTF-16 offsets and measured
// widths, and the host paints a hyphen-minus at the line break. Fail open — an unknown
// language, a script mismatch, a long word, a throw, or a pattern mismatch leaves the
// word unchanged. English patterns admit Latin words; Russian patterns admit Cyrillic.
//
// `paragraph-hyphenation.ts` is the host. Do not re-export this file from the layout
// barrel — unused layout imports must not load TeX patterns.

// hyphen is CJS/UMD and ships no types. The factory is the documented default export.
// @ts-expect-error -- untyped CJS default export.
import createHyphenator from 'hyphen';
// @ts-expect-error -- untyped CJS pattern table.
import enUsPatterns from 'hyphen/patterns/en-us';
// @ts-expect-error -- untyped CJS pattern table.
import ruPatterns from 'hyphen/patterns/ru';

/** Soft hyphen the library inserts; stripped when mapping back to source offsets. */
const SOFT_HYPHEN = '\u00AD';

/** Visible hyphen painted at a discretionary break — never stored in span.text. */
export const DISCRETIONARY_HYPHEN_GLYPH = '-';

/** Words longer than this (UTF-16 units) are not hyphenated. */
export const MAX_HYPHENATION_WORD_UTF16 = 64;

/** Distinct `(language, word)` offset lists retained before LRU eviction. */
export const MAX_HYPHENATION_CACHE_ENTRIES = 4096;

/** Admitted hyphenation pattern family. */
export type HyphenationLanguage = 'en' | 'ru';

const LETTERS_ONLY = /^\p{L}+$/u;
const LATIN_LETTER = /^\p{Script=Latin}$/u;
const CYRILLIC_LETTER = /^\p{Script=Cyrillic}$/u;
const BCP_47 = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8}){0,3}$/;
const EMPTY_OFFSETS: readonly number[] = Object.freeze([]);

type HyphenateText = (text: string) => unknown;
type HyphenFactory = (patterns: unknown, options?: { readonly html?: boolean }) => HyphenateText;

const factory = createHyphenator as HyphenFactory;

interface Hyphenators {
  readonly en: HyphenateText;
  readonly ru: HyphenateText;
}

function createHyphenators(): Hyphenators | null {
  try {
    return {
      en: factory(enUsPatterns, { html: false }),
      ru: factory(ruPatterns, { html: false }),
    };
  } catch {
    return null;
  }
}

let hyphenators = createHyphenators();
let hyphenatorCalls = 0;
const offsetCache = new Map<string, readonly number[]>();

function resetHyphenators(): void {
  hyphenators = createHyphenators();
  hyphenatorCalls = 0;
}

/** Drop cached offsets and the library's own word cache. For tests and a full flush. */
export function resetHyphenationCache(): void {
  offsetCache.clear();
  resetHyphenators();
}

/** Current cache occupancy. For tests of the 4096-entry bound. */
export function hyphenationCacheSize(): number {
  return offsetCache.size;
}

/**
 * Admit a BCP 47 tag to a shipped pattern family.
 *
 * Only `en` / `ru` primary subtags (any further subtags) are accepted. Unknown,
 * malformed, or over-long tags return `null`.
 */
export function admittedHyphenationLanguage(
  tag: string | null | undefined
): HyphenationLanguage | null {
  if (tag === null || tag === undefined) return null;
  const value = tag.trim();
  if (!BCP_47.test(value)) return null;
  const primary = value.split('-', 1)[0]!.toLowerCase();
  if (primary === 'en') return 'en';
  if (primary === 'ru') return 'ru';
  return null;
}

function isLettersOnly(word: string): boolean {
  return LETTERS_ONLY.test(word);
}

/**
 * English patterns admit Latin letters only. Russian patterns admit Cyrillic letters only.
 *
 * An unsupported script fails open here and never reaches the TeX table.
 */
function wordMatchesAdmittedScript(word: string, language: HyphenationLanguage): boolean {
  const letter = language === 'en' ? LATIN_LETTER : CYRILLIC_LETTER;
  for (const char of word) {
    if (!letter.test(char)) return false;
  }
  return word.length > 0;
}

function isAllCaps(word: string): boolean {
  let hasCasedLetter = false;
  for (const char of word) {
    if (char !== char.toUpperCase()) return false;
    if (char !== char.toLowerCase()) hasCasedLetter = true;
  }
  return hasCasedLetter;
}

function cacheKey(language: HyphenationLanguage, word: string): string {
  return `${language}:${word}`;
}

function cacheGet(key: string): readonly number[] | undefined {
  const hit = offsetCache.get(key);
  if (hit === undefined) return undefined;
  offsetCache.delete(key);
  offsetCache.set(key, hit);
  return hit;
}

function cacheSet(key: string, value: readonly number[]): void {
  if (offsetCache.has(key)) offsetCache.delete(key);
  else if (offsetCache.size >= MAX_HYPHENATION_CACHE_ENTRIES) {
    const oldest = offsetCache.keys().next().value;
    if (oldest !== undefined) offsetCache.delete(oldest);
  }
  offsetCache.set(key, value);
}

function offsetsFromHyphenated(original: string, hyphenated: string): readonly number[] {
  if (hyphenated === original) return EMPTY_OFFSETS;
  const offsets: number[] = [];
  let source = 0;
  for (let index = 0; index < hyphenated.length; index += 1) {
    const char = hyphenated.charAt(index);
    if (char === SOFT_HYPHEN) {
      if (source > 0 && source < original.length) offsets.push(source);
      continue;
    }
    if (char !== original.charAt(source)) return EMPTY_OFFSETS;
    source += 1;
  }
  if (source !== original.length) return EMPTY_OFFSETS;
  return offsets.length === 0 ? EMPTY_OFFSETS : Object.freeze(offsets);
}

function hyphenateAdmitted(language: HyphenationLanguage, word: string): string {
  if (!hyphenators) return word;
  if (hyphenatorCalls >= MAX_HYPHENATION_CACHE_ENTRIES) resetHyphenators();
  if (!hyphenators) return word;
  hyphenatorCalls += 1;
  try {
    const result = hyphenators[language](word);
    return typeof result === 'string' ? result : word;
  } catch {
    return word;
  }
}

/**
 * UTF-16 offsets at which `word` may take a discretionary hyphen, or empty on fail-open.
 *
 * Offsets point BETWEEN characters (after the prefix that stays on the current line).
 * The source string is never modified.
 */
export function hyphenationBreakOffsets(
  word: string,
  language: string | null | undefined,
  options?: { readonly doNotHyphenateCaps?: boolean }
): readonly number[] {
  const admitted = admittedHyphenationLanguage(language);
  if (!admitted) return EMPTY_OFFSETS;
  if (word.length === 0 || word.length > MAX_HYPHENATION_WORD_UTF16) return EMPTY_OFFSETS;
  if (!isLettersOnly(word)) return EMPTY_OFFSETS;
  if (!wordMatchesAdmittedScript(word, admitted)) return EMPTY_OFFSETS;
  if (options?.doNotHyphenateCaps === true && isAllCaps(word)) return EMPTY_OFFSETS;
  const key = cacheKey(admitted, word);
  const cached = cacheGet(key);
  if (cached !== undefined) return cached;
  const offsets = offsetsFromHyphenated(word, hyphenateAdmitted(admitted, word));
  cacheSet(key, offsets);
  return offsets;
}

/** Last discretionary hyphen that still fits `availableWidthPt`. */
export interface DiscretionaryHyphenBreak {
  /** UTF-16 offset in the source word; the hyphen is painted AFTER this offset. */
  readonly utf16Offset: number;
  /** Measured width of the prefix plus {@link DISCRETIONARY_HYPHEN_GLYPH}, in points. */
  readonly widthPt: number;
  /** Measured width of the hyphen glyph alone, in points. */
  readonly hyphenWidthPt: number;
}

/**
 * Last hyphenation point whose prefix plus a hyphen glyph fits `availableWidthPt`.
 *
 * Returns offsets and measured widths only. Never inserts U+00AD, never mutates `word`.
 * `null` means no point fits (or hyphenation is refused); the host keeps the whole word.
 */
export function lastFittingDiscretionaryHyphen(
  word: string,
  language: string | null | undefined,
  availableWidthPt: number,
  measure: (text: string) => number,
  options?: { readonly doNotHyphenateCaps?: boolean }
): DiscretionaryHyphenBreak | null {
  if (!Number.isFinite(availableWidthPt) || availableWidthPt <= 0) return null;
  const offsets = hyphenationBreakOffsets(word, language, options);
  if (offsets.length === 0) return null;
  try {
    const hyphenWidthPt = measure(DISCRETIONARY_HYPHEN_GLYPH);
    if (!Number.isFinite(hyphenWidthPt) || hyphenWidthPt < 0) return null;
    for (let index = offsets.length - 1; index >= 0; index -= 1) {
      const utf16Offset = offsets[index]!;
      if (utf16Offset <= 0 || utf16Offset >= word.length) continue;
      const widthPt = measure(word.slice(0, utf16Offset) + DISCRETIONARY_HYPHEN_GLYPH);
      if (!Number.isFinite(widthPt) || widthPt <= 0 || widthPt > availableWidthPt) continue;
      return { utf16Offset, widthPt, hyphenWidthPt };
    }
  } catch {
    return null;
  }
  return null;
}

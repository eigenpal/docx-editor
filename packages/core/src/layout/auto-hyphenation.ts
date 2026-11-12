// `w:settings/w:autoHyphenation` hyphenates words at the end of a line,
// `w:settings/w:doNotHyphenateCaps` keeps words in capitals whole, and
// `w:pPr/w:suppressAutoHyphens` turns hyphenation off for one paragraph. The editor does not
// paint hyphens. But in compatibility mode 15 an autofit column is measured with hyphenation,
// so a long word does not widen its column. The autofit minimum reads these settings.

import {
  WML_NAMESPACE_URI,
  type OoxmlElement,
  type OoxmlProperty,
} from '@docx-editor.dev/core/store';

/** The document hyphenation settings that the autofit minimum reads. @internal */
export interface AutoHyphenationSettings {
  /** `w:autoHyphenation` is on. */
  readonly autoHyphenation?: true;
  /** `w:doNotHyphenateCaps` is on: a word with no lowercase letter stays whole. */
  readonly doNotHyphenateCaps?: true;
}

/** Letters of the scripts that are hyphenated with a dictionary. */
const HYPHENATED_LETTER = /[\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}]/u;
const LETTER = /\p{L}/u;
const LOWERCASE = /\p{Ll}/u;

function isOn(value: string | undefined): boolean {
  return value === undefined || value === '1' || value === 'true' || value === 'on';
}

/** Whether a settings root turns on the `w:` toggle `localName`. The last declaration wins. */
function settingsToggle(root: OoxmlElement | null, localName: string): boolean {
  let enabled = false;
  for (const child of root?.children ?? []) {
    if (
      child.kind === 'textValue' ||
      child.namespaceUri !== WML_NAMESPACE_URI ||
      child.localName !== localName
    )
      continue;
    enabled = isOn(
      child.attributes.find(
        (item) => item.namespaceUri === WML_NAMESPACE_URI && item.localName === 'val'
      )?.value
    );
  }
  return enabled;
}

/** The hyphenation settings of a settings root, with only the toggles that are on. */
export function autoHyphenationFromSettings(root: OoxmlElement | null): AutoHyphenationSettings {
  if (!settingsToggle(root, 'autoHyphenation')) return {};
  return settingsToggle(root, 'doNotHyphenateCaps')
    ? { autoHyphenation: true, doNotHyphenateCaps: true }
    : { autoHyphenation: true };
}

/** Whether cascaded paragraph properties turn off automatic hyphenation. The last one wins. */
export function paragraphSuppressesAutoHyphens(props: readonly OoxmlProperty[]): boolean {
  let suppressed = false;
  for (const prop of props)
    if (prop.localName === 'suppressAutoHyphens') suppressed = isOn(prop.attributes?.val);
  return suppressed;
}

/** Vowels of the hyphenated scripts, compared on the lowercase base letter. */
const VOWELS = new Set('aeiouyаеиоуыэюяіїєαεηιουω');
/** A hyphenated word keeps at least this many letters before its first point and after its last. */
const LEADING_LETTERS = 2;
const TRAILING_LETTERS = 3;

function isVowel(char: string): boolean {
  const lower = char.toLowerCase();
  return VOWELS.has(lower) || (lower > '\u007f' && VOWELS.has(lower.normalize('NFD').charAt(0)));
}

/**
 * Syllable points of the word `text[start, end)`: each consonant cluster between two vowel
 * groups breaks before its last consonant, as in `cus-tom` and `char-ac-ter`. A word with one
 * vowel group stays whole.
 */
function syllablePoints(text: string, start: number, end: number, points: number[]): void {
  let groupEnd = -1;
  for (let index = start; index < end; index++) {
    if (!isVowel(text[index]!)) continue;
    const point = index - 1;
    if (
      groupEnd >= 0 &&
      point >= groupEnd &&
      point >= start + LEADING_LETTERS &&
      point <= end - TRAILING_LETTERS
    )
      points.push(point);
    while (index + 1 < end && isVowel(text[index + 1]!)) index++;
    groupEnd = index + 1;
  }
}

/** Break opportunities of a text run, and which of them are hyphenation points. @internal */
export interface HyphenationCuts {
  readonly cuts: readonly number[];
  /** The cuts where a fragment ends with a hyphen. */
  readonly hyphens: ReadonlySet<number>;
}

/**
 * Add hyphenation points to the break opportunities of `text`. A dictionary chooses the real
 * points. The editor has no dictionary, so it estimates them for each word of Latin, Greek or
 * Cyrillic letters: a word breaks between syllables, never inside a vowel group, and keeps
 * two letters before its first point and three after its last. With `keepCapitals`, a word
 * with no lowercase letter stays whole.
 */
export function withHyphenationCuts(
  text: string,
  boundaries: readonly number[],
  keepCapitals = false
): HyphenationCuts {
  const points: number[] = [];
  for (let start = 0; start < text.length;) {
    if (!LETTER.test(text[start]!)) {
      start++;
      continue;
    }
    let end = start;
    let lower = false;
    let hyphenated = true;
    for (; end < text.length && LETTER.test(text[end]!); end++) {
      lower ||= LOWERCASE.test(text[end]!);
      hyphenated &&= HYPHENATED_LETTER.test(text[end]!);
    }
    if (hyphenated && (lower || !keepCapitals)) syllablePoints(text, start, end, points);
    start = end;
  }
  const existing = new Set(boundaries);
  const hyphens = new Set(points.filter((point) => !existing.has(point)));
  return { cuts: [...boundaries, ...hyphens].sort((a, b) => a - b), hyphens };
}

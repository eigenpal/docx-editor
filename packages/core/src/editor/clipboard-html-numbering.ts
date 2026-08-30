// The numbering part the external-HTML projection assembles for its lists — split from
// clipboard-html-read.ts at the max-lines cap. Same shape the store's numbering writer
// produces; the projection allocates the numIds and this module renders the definitions.

import { escapeXmlAttribute } from '../store/package/sinks.ts';
import { parseInlineStyle } from './clipboard-html-styles.ts';

const WML_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

export type HtmlListKind =
  | 'bullet'
  | 'decimal'
  | 'upperRoman'
  | 'lowerRoman'
  | 'upperLetter'
  | 'lowerLetter';

export type HtmlListLevel = {
  readonly kind: HtmlListKind;
  readonly start: number;
};

export type HtmlListAllocation = {
  readonly numId: string;
  /** Format and start per OBSERVED `w:ilvl`; unobserved levels take defaults. */
  readonly levels: Map<number, HtmlListLevel>;
};

// Symbol-font codepoints Word writes (private-use range), as escapes so they are not
// invisible literals in the source; see store/package/numbering-part.ts.
const BULLET_LEVELS = [
  { text: '\uF0B7', font: 'Symbol' },
  { text: 'o', font: 'Courier New' },
  { text: '\uF0A7', font: 'Wingdings' },
] as const;

/** One `w:lvl` in strict CT_Lvl order: start, numFmt, lvlText, lvlJc, pPr, rPr. */
function levelXml(kind: HtmlListKind, start: number, ilvl: number): string {
  const left = 720 * (ilvl + 1);
  if (kind === 'bullet') {
    const bullet = BULLET_LEVELS[ilvl % BULLET_LEVELS.length]!;
    return (
      `<w:lvl w:ilvl="${ilvl}"><w:start w:val="1"/><w:numFmt w:val="bullet"/>` +
      `<w:lvlText w:val="${escapeXmlAttribute(bullet.text)}"/><w:lvlJc w:val="left"/>` +
      `<w:pPr><w:ind w:left="${left}" w:hanging="360"/></w:pPr>` +
      `<w:rPr><w:rFonts w:ascii="${bullet.font}" w:hAnsi="${bullet.font}" w:hint="default"/></w:rPr>` +
      '</w:lvl>'
    );
  }
  // Word right-aligns roman markers in a narrower 180-twip hanging slot — the same
  // geometry the store's numbering writer synthesizes, so pasted and toolbar-made
  // lists match.
  const roman = kind === 'lowerRoman' || kind === 'upperRoman';
  return (
    `<w:lvl w:ilvl="${ilvl}"><w:start w:val="${start}"/>` +
    `<w:numFmt w:val="${kind}"/>` +
    `<w:lvlText w:val="%${ilvl + 1}."/><w:lvlJc w:val="${roman ? 'right' : 'left'}"/>` +
    `<w:pPr><w:ind w:left="${left}" w:hanging="${roman ? 180 : 360}"/></w:pPr></w:lvl>`
  );
}

const ROMAN_DIGIT_VALUES: ReadonlyMap<string, number> = new Map([
  ['i', 1],
  ['v', 5],
  ['x', 10],
  ['l', 50],
  ['c', 100],
  ['d', 500],
  ['m', 1000],
]);

const WORD_LEVEL_FORMATS: ReadonlyMap<string, HtmlListKind> = new Map([
  ['alpha-lower', 'lowerLetter'],
  ['alpha-upper', 'upperLetter'],
  ['roman-lower', 'lowerRoman'],
  ['roman-upper', 'upperRoman'],
  ['bullet', 'bullet'],
  ['image', 'bullet'],
  ['decimal', 'decimal'],
  ['arabic', 'decimal'],
]);

export interface WordListLevelDefinition {
  readonly kind: HtmlListKind;
  readonly start: number | null;
}

// Bounded: the block is a character class capped at 2048 (no backtracking blowup).
const WORD_LIST_LEVEL_RULE =
  /@list\s+l(\d{1,4}):level([1-9])(?:\s+lfo\d{1,4})?\s*\{([^{}]{0,2048})\}/g;

/**
 * Bounded scan of Word's head `@list lN:levelM` rules: the STRUCTURED number format
 * and start-at, so marker-glyph sniffing is only a fallback. A rule with no
 * `mso-level-number-format` is decimal (Word omits the default); an unknown format
 * yields no entry and leaves the level to the sniffer.
 */
export function wordListDefinitionsFromStyleText(
  css: string
): ReadonlyMap<string, WordListLevelDefinition> {
  const out = new Map<string, WordListLevelDefinition>();
  if (css.length === 0 || css.length > 262_200) return out;
  WORD_LIST_LEVEL_RULE.lastIndex = 0;
  let match: RegExpExecArray | null;
  let rules = 0;
  while ((match = WORD_LIST_LEVEL_RULE.exec(css)) !== null && rules < 512) {
    rules += 1;
    let kind: HtmlListKind | null = 'decimal';
    let start: number | null = null;
    for (const declaration of match[3]!.split(';')) {
      const colon = declaration.indexOf(':');
      if (colon <= 0) continue;
      const name = declaration.slice(0, colon).trim().toLowerCase();
      const value = declaration
        .slice(colon + 1)
        .trim()
        .toLowerCase();
      if (name === 'mso-level-number-format') {
        kind = WORD_LEVEL_FORMATS.get(value) ?? null;
      } else if (name === 'mso-level-start-at' && /^\d{1,5}$/.test(value)) {
        start = Math.min(32_767, Number.parseInt(value, 10));
      }
    }
    if (kind === null) continue;
    const key = `l${match[1]}:level${match[2]}`;
    if (!out.has(key)) out.set(key, { kind, start });
  }
  return out;
}

/** The ordinal a marker glyph names UNDER a known format, or null when it does not parse. */
export function htmlListStartFromMarker(marker: string, kind: HtmlListKind): number | null {
  const trimmed = marker.trim().replace(/^\(/, '');
  if (kind === 'decimal') {
    // A multilevel marker like '2.1.' names THIS level with its LAST ordinal.
    const dotted = /^(\d{1,5}(?:\.\d{1,5})*)/.exec(trimmed);
    if (!dotted) return null;
    const segments = dotted[1]!.split('.');
    return Math.min(32_767, Number.parseInt(segments[segments.length - 1]!, 10));
  }
  if (kind === 'lowerRoman' || kind === 'upperRoman') {
    const run = /^([A-Za-z]{1,8})/.exec(trimmed);
    return run ? romanValueOf(run[1]!) : null;
  }
  if (kind === 'lowerLetter' || kind === 'upperLetter') {
    const run = /^(([A-Za-z])\2{0,4})(?![A-Za-z])/.exec(trimmed);
    if (!run) return null;
    const code = run[2]!.toLowerCase().charCodeAt(0);
    return Math.min(32_767, (run[1]!.length - 1) * 26 + (code - 96));
  }
  return null;
}

const ROMAN_GRAMMAR = /^m{0,4}(cm|cd|d?c{0,3})(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})$/;

/** The ordinal a valid roman marker names ('iv' → 4), or null for invalid grammar. */
function romanValueOf(token: string): number | null {
  const lower = token.toLowerCase();
  if (!ROMAN_GRAMMAR.test(lower)) return null;
  let total = 0;
  let previous = 0;
  for (const char of lower) {
    const value = ROMAN_DIGIT_VALUES.get(char);
    if (value === undefined) return null;
    total += value;
    if (previous > 0 && previous < value) total -= 2 * previous;
    previous = value;
  }
  return total > 0 && total <= 32_767 ? total : null;
}

export function htmlListKindAndStart(marker: string): {
  readonly kind: HtmlListKind;
  readonly start: number;
} {
  // Word wraps some formats in parentheses — '(1)', '(a)' — so the matchers see the
  // ordinal itself. The closing bracket then satisfies the `[.)]` terminator. A
  // multilevel marker like '2.1.' names THIS level with its LAST ordinal.
  const trimmed = marker.trim().replace(/^\(/, '');
  const decimal = /^(\d{1,5}(?:\.\d{1,5})*)[.)]/.exec(trimmed);
  if (decimal) {
    const segments = decimal[1]!.split('.');
    return {
      kind: 'decimal',
      start: Math.min(32_767, Number.parseInt(segments[segments.length - 1]!, 10)),
    };
  }
  // A single letter is roman only for 'i' — the marker a roman list's first item
  // carries; 'c.' or 'v.' is a letter list that starts mid-alphabet.
  const letter = /^([A-Za-z])[.)]/.exec(trimmed);
  if (letter && !/^[iI]$/.test(letter[1]!)) {
    const code = letter[1]!.charCodeAt(0);
    return code >= 97
      ? { kind: 'lowerLetter', start: code - 96 }
      : { kind: 'upperLetter', start: code - 64 };
  }
  if (letter) return { kind: letter[1] === 'i' ? 'lowerRoman' : 'upperRoman', start: 1 };
  const run = /^([A-Za-z]{2,8})[.)]/.exec(trimmed);
  if (run) {
    const token = run[1]!;
    const lower = token === token.toLowerCase();
    const sameLetter = /^([A-Za-z])\1+$/.test(token);
    // Same-letter runs are letter lists past 'z' ('cc.' is item 29) — EXCEPT an
    // 'i' run, which is overwhelmingly a roman 2 or 3. Mixed runs must parse as
    // valid roman grammar; the start keeps the slice's visible numbers.
    if (!sameLetter || /^[iI]+$/.test(token)) {
      const roman = romanValueOf(token);
      if (roman !== null) {
        return { kind: lower ? 'lowerRoman' : 'upperRoman', start: roman };
      }
    }
    if (sameLetter) {
      const code = token.toLowerCase().charCodeAt(0);
      const start = Math.min(32_767, (token.length - 1) * 26 + (code - 96));
      return { kind: lower ? 'lowerLetter' : 'upperLetter', start };
    }
  }
  // Any remaining digit-bearing marker ('3', '1º', 'Article 1') stays an ordered list.
  const digits = /\d{1,5}/.exec(trimmed);
  if (digits) {
    return { kind: 'decimal', start: Math.min(32_767, Number.parseInt(digits[0]!, 10)) };
  }
  return { kind: 'bullet', start: 1 };
}

const LIST_STYLE_TYPE_KINDS: ReadonlyMap<string, HtmlListKind> = new Map([
  ['decimal', 'decimal'],
  ['upper-alpha', 'upperLetter'],
  ['upper-latin', 'upperLetter'],
  ['lower-alpha', 'lowerLetter'],
  ['lower-latin', 'lowerLetter'],
  ['upper-roman', 'upperRoman'],
  ['lower-roman', 'lowerRoman'],
]);

export function semanticHtmlListKind(element: Element): HtmlListKind {
  if (element.localName.toLowerCase() !== 'ol') return 'bullet';
  // The outbound writer emits `list-style-type` CSS, not the legacy attribute.
  const listStyle = parseInlineStyle(element).get('list-style-type')?.trim().toLowerCase();
  const fromCss = listStyle === undefined ? undefined : LIST_STYLE_TYPE_KINDS.get(listStyle);
  if (fromCss !== undefined) return fromCss;
  const type = element.getAttribute('type');
  if (type === 'A') return 'upperLetter';
  if (type === 'a') return 'lowerLetter';
  if (type === 'I') return 'upperRoman';
  if (type === 'i') return 'lowerRoman';
  return 'decimal';
}

export function semanticHtmlListStart(element: Element): number {
  const raw = element.getAttribute('start')?.trim();
  return raw !== undefined && /^\d{1,5}$/.test(raw)
    ? Math.min(32_767, Number.parseInt(raw, 10))
    : 1;
}

export function numberingPartXml(allocations: readonly HtmlListAllocation[]): string {
  const abstracts = allocations
    .map((allocation, index) => {
      const fallback: HtmlListLevel = allocation.levels.get(0) ??
        allocation.levels.values().next().value ?? { kind: 'decimal', start: 1 };
      const levels = Array.from({ length: 9 }, (_, ilvl) => {
        // An observed level keeps its detected format and start; the rest default —
        // bullets cascade, ordered lists restart as decimal.
        const observed = allocation.levels.get(ilvl);
        if (observed) return levelXml(observed.kind, observed.start, ilvl);
        return levelXml(fallback.kind === 'bullet' ? 'bullet' : 'decimal', 1, ilvl);
      }).join('');
      return (
        `<w:abstractNum w:abstractNumId="${index}">` +
        `<w:multiLevelType w:val="hybridMultilevel"/>${levels}</w:abstractNum>`
      );
    })
    .join('');
  const nums = allocations
    .map(
      (allocation, index) =>
        `<w:num w:numId="${allocation.numId}"><w:abstractNumId w:val="${index}"/></w:num>`
    )
    .join('');
  return `${XML_DECL}<w:numbering xmlns:w="${WML_NS}">${abstracts}${nums}</w:numbering>`;
}

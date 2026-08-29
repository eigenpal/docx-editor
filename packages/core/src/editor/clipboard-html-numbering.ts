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
  const indent = `<w:pPr><w:ind w:left="${left}" w:hanging="360"/></w:pPr>`;
  if (kind === 'bullet') {
    const bullet = BULLET_LEVELS[ilvl % BULLET_LEVELS.length]!;
    return (
      `<w:lvl w:ilvl="${ilvl}"><w:start w:val="1"/><w:numFmt w:val="bullet"/>` +
      `<w:lvlText w:val="${escapeXmlAttribute(bullet.text)}"/><w:lvlJc w:val="left"/>${indent}` +
      `<w:rPr><w:rFonts w:ascii="${bullet.font}" w:hAnsi="${bullet.font}" w:hint="default"/></w:rPr>` +
      '</w:lvl>'
    );
  }
  return (
    `<w:lvl w:ilvl="${ilvl}"><w:start w:val="${start}"/>` +
    `<w:numFmt w:val="${kind}"/>` +
    `<w:lvlText w:val="%${ilvl + 1}."/><w:lvlJc w:val="left"/>${indent}</w:lvl>`
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

/** The ordinal a roman marker names ('iv' → 4), or 1 when it does not parse. */
function romanValueOf(token: string): number {
  let total = 0;
  let previous = 0;
  for (const char of token.toLowerCase()) {
    const value = ROMAN_DIGIT_VALUES.get(char);
    if (value === undefined) return 1;
    total += value;
    if (previous > 0 && previous < value) total -= 2 * previous;
    previous = value;
  }
  return total > 0 && total <= 32_767 ? total : 1;
}

export function htmlListKindAndStart(marker: string): {
  readonly kind: HtmlListKind;
  readonly start: number;
} {
  // Word wraps some formats in parentheses — '(1)', '(a)' — so the matchers see the
  // ordinal itself. The closing bracket then satisfies the `[.)]` terminator.
  const trimmed = marker.trim().replace(/^\(/, '');
  const decimal = /^(\d{1,5})[.)]/.exec(trimmed);
  if (decimal) {
    return { kind: 'decimal', start: Math.min(32_767, Number.parseInt(decimal[1]!, 10)) };
  }
  // A multi-letter roman run is unambiguous. A single letter is roman only for 'i' —
  // the marker a roman list's first item carries; 'c.' or 'v.' is a letter list that
  // starts mid-alphabet. The start parses from the numeral so a pasted slice keeps
  // its visible numbers.
  const upperRoman = /^([IVXLCDM]{2,8}|I)[.)]/.exec(trimmed);
  if (upperRoman) return { kind: 'upperRoman', start: romanValueOf(upperRoman[1]!) };
  const lowerRoman = /^([ivxlcdm]{2,8}|i)[.)]/.exec(trimmed);
  if (lowerRoman) return { kind: 'lowerRoman', start: romanValueOf(lowerRoman[1]!) };
  const letter = /^([A-Za-z])[.)]/.exec(trimmed);
  if (letter) {
    const code = letter[1]!.charCodeAt(0);
    return code >= 97
      ? { kind: 'lowerLetter', start: code - 96 }
      : { kind: 'upperLetter', start: code - 64 };
  }
  // Word letter lists repeat past 'z': 'aa.' is item 27.
  const repeated = /^(([A-Za-z])\2{1,4})[.)]/.exec(trimmed);
  if (repeated) {
    const code = repeated[2]!.charCodeAt(0);
    const start = Math.min(
      32_767,
      (repeated[1]!.length - 1) * 26 + (code >= 97 ? code - 96 : code - 64)
    );
    return { kind: code >= 97 ? 'lowerLetter' : 'upperLetter', start };
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

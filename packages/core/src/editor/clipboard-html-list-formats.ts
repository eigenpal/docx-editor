// List number formats as CSS `list-style-type` values, for the `text/html` clipboard flavor.
//
// An HTML receiver draws list markers itself, from the counter style, so the marker text
// cannot travel. Each `w:numFmt` value (`ST_NumberFormat`, ECMA-376 Part 1, 17.18.59) maps to
// the predefined CSS counter style that writes the same numeral system. A format without one
// copies as `decimal`: the receiver then shows the right number in another script, never a
// wrong number. The kana formats copy as decimal: the CSS kana styles count other letter sets.

/** The `w:numFmt` values an HTML list can carry through a CSS counter style. */
export type CssListNumberFormat =
  | 'decimal'
  | 'decimalZero'
  | 'lowerLetter'
  | 'upperLetter'
  | 'lowerRoman'
  | 'upperRoman'
  | 'none'
  | 'chineseCountingThousand'
  | 'chineseLegalSimplified'
  | 'taiwaneseCountingThousand'
  | 'ideographLegalTraditional'
  | 'japaneseCounting'
  | 'japaneseLegal'
  | 'taiwaneseDigital'
  | 'ideographTraditional'
  | 'ideographZodiac'
  | 'hebrew1'
  | 'hindiNumbers'
  | 'thaiNumbers';

/** `w:numFmt` value to CSS `list-style-type`, for the formats that have a counter style. */
const NUM_FMT_CSS: readonly (readonly [CssListNumberFormat, string])[] = [
  ['decimal', 'decimal'],
  ['decimalZero', 'decimal-leading-zero'],
  ['lowerLetter', 'lower-alpha'],
  ['upperLetter', 'upper-alpha'],
  ['lowerRoman', 'lower-roman'],
  ['upperRoman', 'upper-roman'],
  // Marker-suppressed levels must NOT fall back to decimal: the receiver would show numbers
  // the source never displays.
  ['none', 'none'],
  ['chineseCountingThousand', 'simp-chinese-informal'],
  ['chineseLegalSimplified', 'simp-chinese-formal'],
  ['taiwaneseCountingThousand', 'trad-chinese-informal'],
  ['ideographLegalTraditional', 'trad-chinese-formal'],
  ['japaneseCounting', 'japanese-informal'],
  ['japaneseLegal', 'japanese-formal'],
  ['taiwaneseDigital', 'cjk-decimal'],
  ['ideographTraditional', 'cjk-heavenly-stem'],
  ['ideographZodiac', 'cjk-earthly-branch'],
  ['hebrew1', 'hebrew'],
  ['hindiNumbers', 'devanagari'],
  ['thaiNumbers', 'thai'],
];

const NUM_FMT_TO_CSS: ReadonlyMap<string, string> = new Map(NUM_FMT_CSS);

/** CSS `list-style-type` to `w:numFmt`: the map above reversed, plus the CSS aliases. */
const CSS_TO_NUM_FMT: ReadonlyMap<string, CssListNumberFormat> = new Map([
  ...NUM_FMT_CSS.map(([numFmt, css]) => [css, numFmt] as const),
  ['upper-latin', 'upperLetter'],
  ['lower-latin', 'lowerLetter'],
  ['cjk-ideographic', 'taiwaneseCountingThousand'],
]);

/** The `list-style-type` an ordered list level with `numFmt` copies as. */
export function cssListStyleTypeOf(numFmt: string): string {
  return NUM_FMT_TO_CSS.get(numFmt) ?? 'decimal';
}

/** The `w:numFmt` a pasted `list-style-type` maps to, or undefined for an unknown one. */
export function numFmtOfCssListStyleType(listStyleType: string): CssListNumberFormat | undefined {
  return CSS_TO_NUM_FMT.get(listStyleType);
}

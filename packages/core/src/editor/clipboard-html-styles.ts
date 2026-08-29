import { clipboardLanguageTag } from './clipboard-html-language.ts';

/** A bounded absolute CSS length in points. Word clipboard HTML commonly uses `in`. */
export function parseCssLengthPt(value: string): number | null {
  const match = /^(-?(?:\d+(?:\.\d+)?|\.\d+))(px|pt|in|cm|mm|pc)$/.exec(value.trim().toLowerCase());
  if (!match) return null;
  const magnitude = Number.parseFloat(match[1]!);
  if (!Number.isFinite(magnitude)) return null;
  switch (match[2]) {
    case 'px':
      return magnitude * 0.75;
    case 'in':
      return magnitude * 72;
    case 'cm':
      return (magnitude * 72) / 2.54;
    case 'mm':
      return (magnitude * 72) / 25.4;
    case 'pc':
      return magnitude * 12;
    default:
      return magnitude;
  }
}

/** Whether bare image extents use Word's point-based clipboard convention. */
export function isWordClipboardHtml(html: string): boolean {
  return (
    html.includes('urn:schemas-microsoft-com:office') ||
    html.includes('class=Mso') ||
    html.includes('class="Mso') ||
    html.includes("class='Mso")
  );
}

/** A built-in Word style named by Word desktop's clipboard HTML class. */
export function wordParagraphStyleId(element: Element, wordHtml: boolean): string | undefined {
  for (const className of element.classList) {
    const heading = /^MsoHeading([1-9])$/.exec(className);
    if (heading) return `Heading${heading[1]}`;
    const onlineHeading = /^Heading([1-9])$/.exec(className);
    if (onlineHeading) return `Heading${onlineHeading[1]}`;
    if (className === 'MsoCaption') return 'Caption';
    if (className === 'MsoTitle') return 'Title';
    if (className === 'MsoSubtitle') return 'Subtitle';
    if (className === 'MsoQuote') return 'Quote';
  }
  const headingTag = wordHtml ? /^h([1-6])$/.exec(tagOf(element)) : null;
  return headingTag ? `Heading${headingTag[1]}` : undefined;
}

export type HtmlParagraphAlign = 'left' | 'center' | 'right' | 'both';

/** Cap on concatenated `<style>` text scanned for Word class `text-align`. */
export const WORD_STYLE_TEXT_MAX = 32_768;
const WORD_STYLE_ELEMENT_MAX = 8;
const WORD_STYLE_RULE_MAX = 256;
const WORD_STYLE_SELECTOR_MAX = 256;
const WORD_STYLE_BLOCK_MAX = 2_048;
const WORD_STYLE_SELECTOR_LIST_MAX = 8;

const WORD_PARAGRAPH_CLASSES: ReadonlySet<string> = new Set([
  'MsoTitle',
  'MsoSubtitle',
  'MsoCaption',
  'MsoQuote',
  ...Array.from({ length: 9 }, (_, index) => `MsoHeading${index + 1}`),
  ...Array.from({ length: 9 }, (_, index) => `Heading${index + 1}`),
]);

const ALIGN_VALUES: ReadonlyMap<string, HtmlParagraphAlign> = new Map([
  ['left', 'left'],
  ['start', 'left'],
  ['center', 'center'],
  ['right', 'right'],
  ['end', 'right'],
  ['justify', 'both'],
]);

const WORD_CLASS_SELECTOR = /^\s*(p|li|div)\.([A-Za-z][A-Za-z0-9]{0,31})\s*$/i;

function stripHtmlCommentMarkers(css: string): string {
  let out = '';
  for (let i = 0; i < css.length; i += 1) {
    if (css.startsWith('<!--', i)) {
      i += 3;
      continue;
    }
    if (css.startsWith('-->', i)) {
      i += 2;
      continue;
    }
    out += css[i];
  }
  return out;
}

function skipBalancedBlock(text: string, open: number): number | null {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    const char = text[i];
    if (char === '{') {
      depth += 1;
      if (depth > 4) return null;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return null;
}

function skipAtRule(text: string, at: number): number | null {
  for (let i = at + 1; i < text.length; i += 1) {
    const char = text[i];
    if (char === ';') return i + 1;
    if (char === '{') return skipBalancedBlock(text, i);
  }
  return null;
}

function allowlistedClassesOf(selector: string): readonly string[] | null {
  const parts = selector.split(',');
  if (parts.length === 0 || parts.length > WORD_STYLE_SELECTOR_LIST_MAX) return null;
  const classes: string[] = [];
  for (const part of parts) {
    const match = WORD_CLASS_SELECTOR.exec(part);
    if (!match) return null;
    const className = match[2]!;
    if (!WORD_PARAGRAPH_CLASSES.has(className)) return null;
    if (!classes.includes(className)) classes.push(className);
  }
  return classes;
}

function textAlignOf(block: string): HtmlParagraphAlign | undefined {
  let found: HtmlParagraphAlign | undefined;
  for (const declaration of block.split(';')) {
    const colon = declaration.indexOf(':');
    if (colon <= 0) continue;
    const name = declaration.slice(0, colon).trim().toLowerCase();
    if (name !== 'text-align') continue;
    const raw = declaration
      .slice(colon + 1)
      .trim()
      .toLowerCase();
    if (raw.length === 0 || raw.length > 32 || raw.includes('(')) continue;
    let end = 0;
    while (end < raw.length && raw.charCodeAt(end)! > 32) end += 1;
    const jc = ALIGN_VALUES.get(raw.slice(0, end));
    if (jc !== undefined) found = jc;
  }
  return found;
}

/**
 * Bounded scan of Word clipboard `<style>` text: exact `p|li|div.<allowlisted-class>`
 * selectors only, `text-align` only. Not a CSS cascade. Oversized or malformed input
 * yields no entries rather than a partial hostile parse.
 */
function scanWordClassAlignments(css: string): {
  readonly ok: boolean;
  readonly alignments: ReadonlyMap<string, HtmlParagraphAlign>;
} {
  const out = new Map<string, HtmlParagraphAlign>();
  const failed = () => ({ ok: false, alignments: new Map<string, HtmlParagraphAlign>() });
  if (css.length === 0) return { ok: true, alignments: out };
  if (css.length > WORD_STYLE_TEXT_MAX) return failed();
  const text = stripHtmlCommentMarkers(css);
  let i = 0;
  let rules = 0;
  while (i < text.length && rules < WORD_STYLE_RULE_MAX) {
    while (i < text.length && text.charCodeAt(i)! <= 32) i += 1;
    if (i >= text.length) break;
    if (text[i] === '@') {
      const next = skipAtRule(text, i);
      if (next === null) return failed();
      i = next;
      continue;
    }
    const brace = text.indexOf('{', i);
    if (brace < 0) return failed();
    const selector = text.slice(i, brace);
    const close = text.indexOf('}', brace + 1);
    if (close < 0) return failed();
    const block = text.slice(brace + 1, close);
    rules += 1;
    i = close + 1;
    if (selector.length > WORD_STYLE_SELECTOR_MAX || block.length > WORD_STYLE_BLOCK_MAX) {
      return failed();
    }
    if (block.includes('{')) return failed();
    const classes = allowlistedClassesOf(selector);
    const jc = textAlignOf(block);
    if (!classes || jc === undefined) continue;
    for (const className of classes) out.set(className, jc);
  }
  while (i < text.length && text.charCodeAt(i)! <= 32) i += 1;
  if (i < text.length) return failed();
  return { ok: true, alignments: out };
}

export function wordClassAlignmentsFromStyleText(
  css: string
): ReadonlyMap<string, HtmlParagraphAlign> {
  return scanWordClassAlignments(css).alignments;
}

/** `textContent` of inert `<style>` elements, capped, never `innerHTML`. */
export function wordClassAlignmentsFromDocument(
  doc: Document
): ReadonlyMap<string, HtmlParagraphAlign> {
  const out = new Map<string, HtmlParagraphAlign>();
  const styles = doc.getElementsByTagName('style');
  if (styles.length > WORD_STYLE_ELEMENT_MAX) return out;
  let total = 0;
  for (let index = 0; index < styles.length; index += 1) {
    const raw = styles[index]?.textContent ?? '';
    if (raw.length > WORD_STYLE_TEXT_MAX) return new Map();
    if (total + raw.length > WORD_STYLE_TEXT_MAX) return new Map();
    total += raw.length;
    const scan = scanWordClassAlignments(raw);
    if (!scan.ok) return new Map();
    for (const [className, jc] of scan.alignments) {
      out.set(className, jc);
    }
  }
  return out;
}

/**
 * Stylesheet class `text-align`, then the HTML `align` attribute Word still emits.
 * Inline CSS wins afterwards in `applyParaCss`.
 */
export function applyWordParagraphAlignment(
  para: HtmlParaProps,
  element: Element,
  classAlignments: ReadonlyMap<string, HtmlParagraphAlign>
): void {
  for (const className of element.classList) {
    const jc = classAlignments.get(className);
    if (jc !== undefined) {
      para.jc = jc;
      break;
    }
  }
  const align = element.getAttribute('align')?.trim().toLowerCase();
  if (align === 'left' || align === 'center' || align === 'right') para.jc = align;
  else if (align === 'justify') para.jc = 'both';
}

/** An image extent in CSS pixels, including Word's bare-point convention. */
export function imageDimensionPx(
  element: Element,
  style: ReadonlyMap<string, string>,
  axis: 'width' | 'height',
  wordHtml: boolean
): number | null {
  const pt = parseCssLengthPt(style.get(axis) ?? '');
  if (pt !== null && pt > 0) return pt / 0.75;
  const attr = element.getAttribute(axis)?.trim() ?? '';
  if (!/^[1-9]\d{0,4}$/.test(attr)) return null;
  const value = Number.parseInt(attr, 10);
  return wordHtml ? value / 0.75 : value;
}

export function isElement(node: Node): node is Element {
  return node.nodeType === 1;
}

export function tagOf(element: Element): string {
  return element.tagName.toLowerCase();
}

export interface HtmlRunProps {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  underlineVal?: 'single' | 'double' | 'thick' | 'dotted' | 'dash' | 'wave';
  underlineColor?: string;
  strike?: boolean;
  doubleStrike?: boolean;
  caps?: boolean;
  smallCaps?: boolean;
  vertAlign?: 'subscript' | 'superscript';
  /** RRGGBB uppercase. */
  color?: string;
  /** ST_HighlightColor name. */
  highlight?: string;
  /** RRGGBB uppercase, run shading fill. */
  shdFill?: string;
  szHalfPoints?: number;
  font?: string;
  charSpacingTwentieths?: number;
  lang?: string;
  rtl?: boolean;
}

export type HtmlTabAlignment = 'left' | 'center' | 'right' | 'decimal' | 'bar';
export type HtmlTabLeader = 'dot' | 'hyphen' | 'underscore' | 'middleDot' | 'heavy';

export interface HtmlTabStop {
  readonly val: HtmlTabAlignment;
  readonly posTwips: number;
  readonly leader?: HtmlTabLeader;
}

export type HtmlParagraphBorderEdge = 'top' | 'left' | 'bottom' | 'right';

export interface HtmlParagraphBorder {
  readonly val: 'single' | 'double' | 'dotted' | 'dashed';
  readonly szEighthPoints: number;
  readonly color: string;
}

export interface HtmlParaProps {
  styleId?: string;
  jc?: HtmlParagraphAlign;
  indLeftTwips?: number;
  indRightTwips?: number;
  /** Positive → `w:firstLine`, negative → `w:hanging`. */
  firstLineTwips?: number;
  spacingBeforeTwips?: number;
  spacingAfterTwips?: number;
  /** `w:spacing w:line`; 240ths for auto, twips for exact and at-least. */
  lineTwentieths?: number;
  lineRule?: 'auto' | 'exact' | 'atLeast';
  keepNext?: boolean;
  keepLines?: boolean;
  pageBreakBefore?: boolean;
  widowControl?: boolean;
  shdFill?: string;
  tabs?: readonly HtmlTabStop[];
  borders?: Readonly<Partial<Record<HtmlParagraphBorderEdge, HtmlParagraphBorder>>>;
  numPr?: { readonly numId: string; readonly ilvl: number };
  bidi?: boolean;
}

const NAMED_COLORS = new Map(
  (
    'black:000000 white:FFFFFF red:FF0000 green:008000 blue:0000FF yellow:FFFF00 gray:808080 ' +
    'grey:808080 silver:C0C0C0 maroon:800000 navy:000080 purple:800080 orange:FFA500 ' +
    'aqua:00FFFF cyan:00FFFF fuchsia:FF00FF magenta:FF00FF lime:00FF00 olive:808000 ' +
    'windowtext:000000'
  )
    .split(' ')
    .map((pair) => pair.split(':') as [string, string])
);

/**
 * CSS / `mso-highlight` names → `ST_HighlightColor`. Word's highlighter writes
 * `background:yellow;mso-highlight:yellow` and the CSS1 aliases aqua/fuchsia/lime/olive.
 */
const HIGHLIGHT_ALIASES: ReadonlyMap<string, string> = new Map([
  ['yellow', 'yellow'],
  ['aqua', 'cyan'],
  ['cyan', 'cyan'],
  ['fuchsia', 'magenta'],
  ['magenta', 'magenta'],
  ['lime', 'green'],
  ['olive', 'darkYellow'],
  ['red', 'red'],
  ['blue', 'blue'],
  ['black', 'black'],
  ['white', 'white'],
  ['darkblue', 'darkBlue'],
  ['darkcyan', 'darkCyan'],
  ['darkgray', 'darkGray'],
  ['darkgrey', 'darkGray'],
  ['darkgreen', 'darkGreen'],
  ['darkmagenta', 'darkMagenta'],
  ['darkred', 'darkRed'],
  ['darkyellow', 'darkYellow'],
  ['lightgray', 'lightGray'],
  ['lightgrey', 'lightGray'],
]);

const UNSAFE_BACKGROUND = /url\s*\(|image\s*\(|image-set\s*\(|element\s*\(|cross-fade\s*\(/i;
const UNDERLINE_VALUES = new Set(['single', 'double', 'thick', 'dotted', 'dash', 'wave']);

/** Inline style declarations as a Map, so hostile property names never become object keys. */
export function parseInlineStyle(element: Element): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  const raw = element.getAttribute('style');
  if (!raw || raw.length > 8192) return out;
  for (const declaration of raw.split(';')) {
    const colon = declaration.indexOf(':');
    if (colon <= 0) continue;
    const name = declaration.slice(0, colon).trim().toLowerCase();
    const value = declaration.slice(colon + 1).trim();
    if (name.length > 0 && value.length > 0 && !out.has(name)) out.set(name, value);
  }
  return out;
}

/** Normalize a CSS color to RRGGBB uppercase hex, or null when it does not parse. */
export function parseCssColor(value: string): string | null {
  const v = value.trim().toLowerCase();
  const named = NAMED_COLORS.get(v);
  if (named) return named;
  const hex6 = /^#([0-9a-f]{6})$/.exec(v);
  if (hex6) return hex6[1]!.toUpperCase();
  const hex3 = /^#([0-9a-f]{3})$/.exec(v);
  if (hex3) {
    const [r, g, b] = hex3[1]!;
    return `${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  const rgb = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,[^)]*)?\)$/.exec(v);
  if (rgb) {
    const channel = (part: string): string =>
      Math.min(255, Number.parseInt(part, 10)).toString(16).padStart(2, '0');
    return `${channel(rgb[1]!)}${channel(rgb[2]!)}${channel(rgb[3]!)}`.toUpperCase();
  }
  return null;
}

/** A closed ST_HighlightColor name, or undefined when the token is not in the allowlist. */
export function highlightNameOf(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const token = value.trim().toLowerCase();
  if (token.length === 0 || token.length > 32 || /[^a-z]/.test(token)) return undefined;
  return HIGHLIGHT_ALIASES.get(token);
}

/**
 * A solid colour from `background` / `background-color`. Named highlighter colours
 * remain shading. Only `mso-highlight` carries Word highlighter semantics.
 * `url()`, images, and any shorthand that is not wholly a colour are refused.
 */
export function solidBackground(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 128) return null;
  if (UNSAFE_BACKGROUND.test(trimmed)) return null;
  const lower = trimmed.toLowerCase();
  if (lower === 'transparent' || lower === 'none') return null;
  return parseCssColor(trimmed);
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

const TAB_ALIGNMENTS: ReadonlySet<HtmlTabAlignment> = new Set([
  'left',
  'center',
  'right',
  'decimal',
  'bar',
]);

const TAB_LEADERS: ReadonlyMap<string, HtmlTabLeader> = new Map([
  ['dotted', 'dot'],
  ['dot', 'dot'],
  ['dashed', 'hyphen'],
  ['hyphen', 'hyphen'],
  ['lined', 'underscore'],
  ['underscore', 'underscore'],
  ['middledot', 'middleDot'],
  ['heavy', 'heavy'],
]);

function tabStopsOf(value: string | undefined): readonly HtmlTabStop[] | undefined {
  if (value === undefined || value.length === 0 || value.length > 512) return undefined;
  let val: HtmlTabAlignment = 'left';
  let leader: HtmlTabLeader | undefined;
  const stops: HtmlTabStop[] = [];
  for (const raw of value.trim().toLowerCase().split(/\s+/)) {
    if (TAB_ALIGNMENTS.has(raw as HtmlTabAlignment)) {
      val = raw as HtmlTabAlignment;
      continue;
    }
    // Word writes `list` on list paragraphs; it behaves as a left tab.
    if (raw === 'list') {
      val = 'left';
      continue;
    }
    const mappedLeader = TAB_LEADERS.get(raw);
    if (mappedLeader !== undefined) {
      leader = mappedLeader;
      continue;
    }
    const points = parseCssLengthPt(raw);
    // Tolerate unknown tokens: keep the stops that do parse.
    if (points === null || points < 0) continue;
    stops.push({
      val,
      posTwips: clamp(Math.round(points * 20), 0, 31_680),
      ...(leader === undefined ? {} : { leader }),
    });
    if (stops.length >= 32) break;
    val = 'left';
    leader = undefined;
  }
  return stops.length > 0 ? stops : undefined;
}

const BORDER_STYLES: ReadonlyMap<string, HtmlParagraphBorder['val']> = new Map([
  ['solid', 'single'],
  ['single', 'single'],
  ['double', 'double'],
  ['dotted', 'dotted'],
  ['dashed', 'dashed'],
]);

/** Whitespace-split a border shorthand without shattering `rgb(0, 0, 0)` tokens. */
export function splitBorderTokens(value: string): readonly string[] {
  return value
    .trim()
    .replace(/\([^)]*\)/g, (group) => group.replace(/\s+/g, ''))
    .split(/\s+/);
}

const BORDER_WIDTH_KEYWORD_PT: ReadonlyMap<string, number> = new Map([
  ['thin', 0.75],
  ['medium', 2.25],
  ['thick', 3.75],
]);

function paragraphBorderOf(value: string | undefined): HtmlParagraphBorder | undefined {
  if (value === undefined || value.length === 0 || value.length > 128) return undefined;
  let val: HtmlParagraphBorder['val'] | undefined;
  let points: number | undefined;
  let color: string | undefined;
  for (const token of splitBorderTokens(value)) {
    const borderStyle = BORDER_STYLES.get(token.toLowerCase());
    if (borderStyle !== undefined) {
      val = borderStyle;
      continue;
    }
    const length = BORDER_WIDTH_KEYWORD_PT.get(token.toLowerCase()) ?? parseCssLengthPt(token);
    if (length !== null) {
      points = length;
      continue;
    }
    const parsedColor = parseCssColor(token);
    if (parsedColor !== null) {
      color = parsedColor;
      continue;
    }
    return undefined;
  }
  if (val === undefined) return undefined;
  // A visible style with no width takes Word's default hairline.
  if (points === undefined) return { val, szEighthPoints: 4, color: color ?? '000000' };
  if (points <= 0) return undefined;
  return {
    val,
    szEighthPoints: clamp(Math.round(points * 8), 2, 96),
    color: color ?? '000000',
  };
}

export function applyRunCss(base: HtmlRunProps, style: ReadonlyMap<string, string>): HtmlRunProps {
  if (style.size === 0) return base;
  const next: HtmlRunProps = { ...base };
  const weight = style.get('font-weight')?.toLowerCase();
  if (weight !== undefined) {
    const numeric = Number.parseInt(weight, 10);
    if (weight === 'bold' || numeric >= 600) next.bold = true;
    else if (weight === 'normal' || numeric < 600) next.bold = false;
  }
  const fontStyle = style.get('font-style');
  if (fontStyle !== undefined) next.italic = fontStyle.toLowerCase().includes('italic');
  const decoration = (
    style.get('text-decoration') ?? style.get('text-decoration-line')
  )?.toLowerCase();
  if (decoration !== undefined) {
    if (decoration.includes('underline')) next.underline = true;
    if (decoration.includes('line-through')) next.strike = true;
    if (decoration.includes('none')) next.underline = next.strike = false;
  }
  if (style.get('font-variant')?.toLowerCase().includes('small-caps')) next.smallCaps = true;
  if (style.get('text-transform')?.trim().toLowerCase() === 'uppercase') next.caps = true;
  const textUnderline = style.get('text-underline');
  if (textUnderline !== undefined && textUnderline.length <= 128) {
    for (const token of textUnderline.trim().split(/\s+/)) {
      const lower = token.toLowerCase();
      if (UNDERLINE_VALUES.has(lower)) {
        next.underline = true;
        next.underlineVal = lower as HtmlRunProps['underlineVal'];
      } else {
        const parsed = parseCssColor(token);
        if (parsed !== null) next.underlineColor = parsed;
      }
    }
  }
  const decorationStyle = style.get('text-decoration-style')?.trim().toLowerCase();
  if (decorationStyle === 'double' && next.strike) next.doubleStrike = true;
  if (next.underline) {
    if (decorationStyle === 'double') next.underlineVal = 'double';
    else if (decorationStyle === 'dotted') next.underlineVal = 'dotted';
    else if (decorationStyle === 'dashed') next.underlineVal = 'dash';
    else if (decorationStyle === 'wavy') next.underlineVal = 'wave';
    const decorationColor = parseCssColor(style.get('text-decoration-color') ?? '');
    if (decorationColor !== null) next.underlineColor = decorationColor;
  }
  const color = parseCssColor(style.get('color') ?? '');
  if (color) next.color = color;
  const msoHighlight = highlightNameOf(style.get('mso-highlight'));
  const backgroundRaw = style.get('background');
  const backgroundColorRaw = style.get('background-color');
  if (msoHighlight) {
    next.highlight = msoHighlight;
    delete next.shdFill;
  } else if (backgroundRaw !== undefined) {
    const parsed = solidBackground(backgroundRaw);
    if (parsed) next.shdFill = parsed;
  } else if (backgroundColorRaw !== undefined) {
    const parsed = solidBackground(backgroundColorRaw);
    if (parsed) next.shdFill = parsed;
  }
  const pt = parseCssLengthPt(style.get('font-size') ?? '');
  if (pt !== null && pt > 0) next.szHalfPoints = clamp(Math.round(pt * 2), 2, 3276);
  const family = style.get('font-family');
  if (family !== undefined) {
    const first = family
      .split(',')[0]!
      .trim()
      .replace(/^['"]|['"]$/g, '');
    if (first.length > 0 && first.length <= 64) next.font = first;
  }
  const letterSpacing = parseCssLengthPt(style.get('letter-spacing') ?? '');
  if (letterSpacing !== null) {
    next.charSpacingTwentieths = clamp(Math.round(letterSpacing * 20), -31_680, 31_680);
  }
  const vertical = style.get('vertical-align');
  if (vertical === 'sub') next.vertAlign = 'subscript';
  else if (vertical === 'super') next.vertAlign = 'superscript';
  const language = clipboardLanguageTag(
    style.get('mso-ansi-language') ??
      style.get('mso-fareast-language') ??
      style.get('mso-bidi-language')
  );
  if (language !== null) next.lang = language;
  if (style.get('direction')?.trim().toLowerCase() === 'rtl') next.rtl = true;
  return next;
}

export function applyParaCss(para: HtmlParaProps, style: ReadonlyMap<string, string>): void {
  const align = style.get('text-align')?.toLowerCase();
  if (align === 'left' || align === 'start') para.jc = 'left';
  else if (align === 'center') para.jc = 'center';
  else if (align === 'right' || align === 'end') para.jc = 'right';
  else if (align === 'justify') para.jc = 'both';
  if (style.get('direction')?.trim().toLowerCase() === 'rtl') para.bidi = true;
  // Zero margins stay unset: a `margin-left:0` reset must not override a numbering
  // level's indent with a direct `w:ind w:left="0"`.
  const marginLeftPt = parseCssLengthPt(style.get('margin-left') ?? '');
  if (marginLeftPt !== null && marginLeftPt > 0) {
    para.indLeftTwips = clamp(Math.round(marginLeftPt * 20), 0, 31_680);
  }
  const marginRightPt = parseCssLengthPt(style.get('margin-right') ?? '');
  if (marginRightPt !== null && marginRightPt > 0) {
    para.indRightTwips = clamp(Math.round(marginRightPt * 20), 0, 31_680);
  }
  const indentPt = parseCssLengthPt(style.get('text-indent') ?? '');
  if (indentPt !== null && indentPt !== 0) {
    const twips = clamp(Math.round(indentPt * 20), -31_680, 31_680);
    if (twips !== 0) para.firstLineTwips = twips;
  }
  const beforePt = parseCssLengthPt(style.get('margin-top') ?? '');
  if (beforePt !== null && beforePt >= 0) {
    para.spacingBeforeTwips = clamp(Math.round(beforePt * 20), 0, 31_680);
  }
  const afterPt = parseCssLengthPt(style.get('margin-bottom') ?? '');
  if (afterPt !== null && afterPt >= 0) {
    para.spacingAfterTwips = clamp(Math.round(afterPt * 20), 0, 31_680);
  }
  const lineHeight = style.get('line-height')?.trim() ?? '';
  const lineRule = style.get('mso-line-height-rule')?.trim().toLowerCase();
  const lineHeightPt = parseCssLengthPt(lineHeight);
  if (lineHeightPt !== null && lineHeightPt > 0) {
    para.lineTwentieths = clamp(Math.round(lineHeightPt * 20), 24, 31_680);
    // Word only writes the rule for `exactly`; a bare absolute line-height is at-least.
    para.lineRule = lineRule === 'exactly' ? 'exact' : 'atLeast';
  } else if (/^\d+(\.\d+)?$/.test(lineHeight) && Number.parseFloat(lineHeight) > 0) {
    para.lineTwentieths = clamp(Math.round(240 * Number.parseFloat(lineHeight)), 24, 9600);
    para.lineRule = 'auto';
  } else if (/^\d+(\.\d+)?%$/.test(lineHeight)) {
    const percentage = Number.parseFloat(lineHeight);
    if (percentage > 0) {
      para.lineTwentieths = clamp(Math.round(2.4 * percentage), 24, 9600);
      para.lineRule = 'auto';
    }
  }
  if (
    style.get('page-break-before')?.trim().toLowerCase() === 'always' ||
    style.get('break-before')?.trim().toLowerCase() === 'page'
  ) {
    para.pageBreakBefore = true;
  }
  if (style.get('page-break-after')?.trim().toLowerCase() === 'avoid') para.keepNext = true;
  if (style.get('page-break-inside')?.trim().toLowerCase() === 'avoid') para.keepLines = true;
  if (
    /^[2-9]\d?$/.test(style.get('widows')?.trim() ?? '') ||
    /^[2-9]\d?$/.test(style.get('orphans')?.trim() ?? '')
  ) {
    para.widowControl = true;
  }
  const shading =
    solidBackground(style.get('background')) ?? solidBackground(style.get('background-color'));
  if (shading) para.shdFill = shading;
  const tabs = tabStopsOf(style.get('tab-stops'));
  if (tabs !== undefined) para.tabs = tabs;
  // Word writes only the shorthand when all four edges match.
  const commonBorder = paragraphBorderOf(style.get('mso-border-alt') ?? style.get('border'));
  const borders: Partial<Record<HtmlParagraphBorderEdge, HtmlParagraphBorder>> = {};
  for (const edge of ['top', 'left', 'bottom', 'right'] as const) {
    const border =
      paragraphBorderOf(style.get(`mso-border-${edge}-alt`)) ??
      paragraphBorderOf(style.get(`border-${edge}`)) ??
      commonBorder;
    if (border !== undefined) borders[edge] = border;
  }
  if (Object.keys(borders).length > 0) para.borders = borders;
}

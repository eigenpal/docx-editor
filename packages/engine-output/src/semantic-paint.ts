// Paint semantic layout records to DOM (task 7.5).
//
// A NON-AUTHORITATIVE CONSUMER. It positions every element from the numbers layout already
// published and never measures anything back: no `getBoundingClientRect`, no `offsetWidth`,
// no `getComputedStyle`, no canvas text metrics. If this file could measure, the DOM would
// become a second source of geometry and the two would drift — which is exactly the
// separation task 7.6 guards.
//
// It is also a trust boundary. Every string here is file-derived, so the DOM is built with
// `createElement` plus `textContent` and never from an HTML string, and every style value
// comes from the RESOLVED style rather than from raw authored text.

import type {
  LineRecord,
  PageRecord,
  ParagraphFragmentRecord,
  ResolvedRunStyle,
  SemanticLayout,
  StyleSpanRecord,
} from '@docx-editor.dev/engine-layout';

export interface PaintOptions {
  /** Points to CSS pixels. 96/72 renders a point as a CSS point at 100% zoom. */
  readonly scale?: number;
  /** Marks painted pages as presentational, so assistive tech reads the editable projection. */
  readonly ariaHidden?: boolean;
}

const HEX = /^[0-9A-Fa-f]{6}$/;
const FONT_NAME = /^[\w \-.+]{1,64}$/;

/** ST_Underline to the nearest CSS decoration style. */
const UNDERLINE_STYLE: Record<string, string> = {
  single: 'solid',
  words: 'solid',
  thick: 'solid',
  double: 'double',
  dotted: 'dotted',
  dottedHeavy: 'dotted',
  dash: 'dashed',
  dashedHeavy: 'dashed',
  dashLong: 'dashed',
  dashLongHeavy: 'dashed',
  dotDash: 'dashed',
  dashDotHeavy: 'dashed',
  dotDotDash: 'dashed',
  dashDotDotHeavy: 'dashed',
  wave: 'wavy',
  wavyHeavy: 'wavy',
  wavyDouble: 'wavy',
};

const HIGHLIGHT: Record<string, string> = {
  black: '#000000',
  blue: '#0000ff',
  cyan: '#00ffff',
  darkBlue: '#000080',
  darkCyan: '#008080',
  darkGray: '#808080',
  darkGreen: '#008000',
  darkMagenta: '#800080',
  darkRed: '#800000',
  darkYellow: '#808000',
  green: '#00ff00',
  lightGray: '#c0c0c0',
  magenta: '#ff00ff',
  red: '#ff0000',
  yellow: '#ffff00',
  white: '#ffffff',
};

/** Apply a resolved run style to an element, value by validated value. */
function applyRunStyle(element: HTMLElement, style: ResolvedRunStyle, scale: number): void {
  const css = element.style;
  css.fontSize = `${style.fontSizePt * scale}px`;
  if (style.bold) css.fontWeight = 'bold';
  if (style.italic) css.fontStyle = 'italic';
  // Re-validated here even though the resolver already checked: this is the sink, and a
  // sink that trusts its caller is one refactor away from being the hole.
  if (style.fontFamily && FONT_NAME.test(style.fontFamily)) {
    css.fontFamily = `"${style.fontFamily}"`;
  }
  if (style.color && HEX.test(style.color)) css.color = `#${style.color}`;
  if (style.highlight && HIGHLIGHT[style.highlight]) {
    css.backgroundColor = HIGHLIGHT[style.highlight]!;
  }
  if (style.caps) css.textTransform = 'uppercase';
  if (style.smallCaps) css.fontVariant = 'small-caps';
  if (style.verticalAlign !== 'baseline') {
    css.verticalAlign = style.verticalAlign === 'superscript' ? 'super' : 'sub';
  }
  if (style.baselineShiftPt !== 0) {
    css.position = 'relative';
    css.top = `${-style.baselineShiftPt * scale}px`;
  }
  if (style.characterSpacingPt !== 0) {
    css.letterSpacing = `${style.characterSpacingPt * scale}px`;
  }

  const decorations: string[] = [];
  if (style.underline) decorations.push('underline');
  if (style.strike || style.doubleStrike) decorations.push('line-through');
  if (decorations.length > 0) {
    css.textDecorationLine = decorations.join(' ');
    if (style.underline) {
      css.textDecorationStyle = UNDERLINE_STYLE[style.underline.variant] ?? 'solid';
      if (style.underline.color && HEX.test(style.underline.color)) {
        css.textDecorationColor = `#${style.underline.color}`;
      }
    }
  }
}

function positioned(
  document: Document,
  tag: string,
  box: { x: number; y: number; width: number; height: number },
  scale: number
): HTMLElement {
  const element = document.createElement(tag);
  element.style.position = 'absolute';
  element.style.left = `${box.x * scale}px`;
  element.style.top = `${box.y * scale}px`;
  element.style.width = `${box.width * scale}px`;
  element.style.height = `${box.height * scale}px`;
  return element;
}

function paintSpan(
  document: Document,
  span: StyleSpanRecord,
  line: LineRecord,
  scale: number
): HTMLElement {
  const element = document.createElement('span');
  element.style.position = 'absolute';
  element.style.left = `${span.box.x * scale}px`;
  // Positioned on the BASELINE published by layout, not by letting the browser decide where
  // the text sits inside the box. That is the difference between painting a record and
  // asking the DOM to lay out again.
  element.style.top = `${(line.baseline - span.box.height * 0.8) * scale}px`;
  element.style.whiteSpace = 'pre';
  element.dataset.paragraphId = span.range.paragraphId;
  element.dataset.start = String(span.range.start);
  element.dataset.end = String(span.range.end);
  applyRunStyle(element, span.style, scale);
  element.textContent = span.text; // SAFE: textContent, never innerHTML
  return element;
}

function paintLine(document: Document, line: LineRecord, scale: number): HTMLElement {
  const element = positioned(document, 'div', line.box, scale);
  element.className = 'docx-line';
  element.dataset.lineId = line.id;
  element.dataset.paragraphId = line.range.paragraphId;
  for (const span of line.spans) element.append(paintSpan(document, span, line, scale));
  return element;
}

function paintFragment(
  document: Document,
  fragment: ParagraphFragmentRecord,
  scale: number
): HTMLElement {
  const element = positioned(document, 'div', fragment.box, scale);
  element.className = 'docx-paragraph-fragment';
  element.dataset.paragraphId = fragment.paragraphId;
  element.dataset.fragmentIndex = String(fragment.fragmentIndex);
  for (const line of fragment.lines) {
    const painted = paintLine(document, line, scale);
    // Line boxes are page-relative; inside a fragment they are drawn relative to it.
    painted.style.top = `${(line.box.y - fragment.box.y) * scale}px`;
    painted.style.left = '0px';
    element.append(painted);
  }
  return element;
}

function paintPage(
  document: Document,
  page: PageRecord,
  options: Required<PaintOptions>
): HTMLElement {
  const element = positioned(document, 'div', page.box, options.scale);
  element.className = 'docx-page';
  element.dataset.pageIndex = String(page.index);
  if (options.ariaHidden) {
    // The painted page is a PICTURE of the document; the editable projection is what
    // assistive technology reads, so this must not be a second, competing reading order.
    element.setAttribute('aria-hidden', 'true');
    element.setAttribute('role', 'presentation');
  }
  const content = document.createElement('div');
  content.className = 'docx-page-content';
  content.style.position = 'absolute';
  content.style.left = `${(page.contentBox.x - page.box.x) * options.scale}px`;
  content.style.top = `${(page.contentBox.y - page.box.y) * options.scale}px`;
  content.style.width = `${page.contentBox.width * options.scale}px`;
  content.style.height = `${page.contentBox.height * options.scale}px`;
  for (const fragment of page.fragments) {
    content.append(paintFragment(document, fragment, options.scale));
  }
  element.append(content);
  return element;
}

/**
 * Paint a whole layout into a container, replacing whatever it held.
 *
 * The container is cleared with `replaceChildren`, not by assigning `innerHTML`, so no
 * file-derived string is ever parsed as markup.
 */
export function paintSemanticLayout(
  container: HTMLElement,
  layout: SemanticLayout,
  options: PaintOptions = {}
): void {
  const resolved: Required<PaintOptions> = {
    scale: options.scale ?? 96 / 72,
    ariaHidden: options.ariaHidden ?? true,
  };
  const document = container.ownerDocument;
  const pages = layout.pages.map((page) => paintPage(document, page, resolved));
  container.dataset.revision = String(layout.revision);
  container.replaceChildren(...pages);
}

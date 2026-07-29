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
  /**
   * Page indices to build in detail (task 9.4).
   *
   * Omitted means all of them. A page left out keeps its size and position but no content,
   * so the document's height and page count are unchanged and scrolling to it reveals it
   * instead of reflowing everything underneath.
   */
  readonly materialize?: ReadonlySet<number>;
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
  // Super/subscript draw at three quarters — the same reduction the measurer applies, so
  // the painted glyphs match the advance layout reserved. Painting them full size while
  // measuring them small made every line containing one slightly too wide.
  const sizeFactor = style.verticalAlign === 'baseline' ? 1 : 0.75;
  css.fontSize = `${style.fontSizePt * sizeFactor * scale}px`;
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
  // Super/subscript shift with a RELATIVE offset, not `vertical-align`. Vertical alignment
  // grows the line box to contain the raised glyph, which pushes a line's selection band
  // past the line layout published and over its neighbour. A relative offset moves the
  // glyph without touching the box, so the band still tiles.
  let shiftPt = style.baselineShiftPt;
  if (style.verticalAlign !== 'baseline') {
    shiftPt +=
      style.verticalAlign === 'superscript' ? style.fontSizePt * 0.33 : -style.fontSizePt * 0.16;
  }
  if (shiftPt !== 0) {
    css.position = 'relative';
    css.top = `${-shiftPt * scale}px`;
  }
  if (style.characterSpacingPt !== 0) {
    css.letterSpacing = `${style.characterSpacingPt * scale}px`;
  }
  if (style.horizontalScalePercent !== 100) {
    // `w:w` stretches glyphs horizontally, and a transform does not change the space the
    // element occupies — so the stretched glyphs, and the selection band drawn over them,
    // spilled across the following run. The reserved advance is given explicitly (layout
    // already scaled it) and the transform fills it.
    css.transformOrigin = 'left';
    css.transform = `scaleX(${style.horizontalScalePercent / 100})`;
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

function paintSpan(document: Document, span: StyleSpanRecord, scale: number): HTMLElement {
  const element = document.createElement('span');
  // Each run is its OWN box, aligned on the baseline.
  //
  // The browser draws a selection band to the box it finds, and a plain inline shares the
  // line box with everything else on the line — so a line mixing 8pt and 36pt highlighted
  // as one slab as tall as the largest run. An inline-block gives every run a box of its
  // own size, which is how Word draws it: the band steps with the text.
  element.style.display = 'inline-block';
  element.style.verticalAlign = 'baseline';
  element.dataset.paragraphId = span.range.paragraphId;
  element.dataset.start = String(span.range.start);
  element.dataset.end = String(span.range.end);
  applyRunStyle(element, span.style, scale);
  if (span.style.horizontalScalePercent !== 100) {
    // The transform stretches the glyphs but reserves nothing, so the element is given the
    // advance layout already scaled. Without it the stretched run painted over its
    // neighbour and their selection bands overlapped.
    element.style.width = `${span.box.width * scale}px`;
  }
  element.textContent = span.text; // SAFE: textContent, never innerHTML
  return element;
}

/**
 * A line is ONE inline flow, not a row of absolutely positioned words.
 *
 * Layout decides what goes on the line, where the line sits, and where the page breaks —
 * the decisions that make output match Word. Placing glyphs WITHIN the line is left to the
 * browser, which is going to rasterise them its own way regardless.
 *
 * Positioning each word independently meant the browser drew the selection highlight once
 * per word, so a selected line came out as a row of separate blocks with seams between
 * them instead of one continuous band. It also put every word at a measured x that
 * disagreed with the rendered advance by a fraction of a pixel, and made `vertical-align`
 * inert — superscript had nothing to align against.
 *
 * `white-space: pre` keeps the browser from re-wrapping a line layout already decided, so
 * a line that measured slightly wide overflows by a hair rather than becoming two lines.
 */
function paintLine(document: Document, line: LineRecord, scale: number): HTMLElement {
  const element = document.createElement('div');
  element.className = 'docx-line';
  element.dataset.lineId = line.id;
  element.dataset.paragraphId = line.range.paragraphId;
  element.style.position = 'absolute';
  element.style.top = `${line.box.y * scale}px`;
  // Alignment is already baked into the span boxes, so the first span's x IS the line's
  // left edge — centred and right-aligned lines start where layout put them.
  const left = line.spans[0]?.box.x ?? line.box.x;
  element.style.left = `${left * scale}px`;
  element.style.height = `${line.box.height * scale}px`;
  // Each run keeps its OWN box, which is how a mixed-size line should highlight: an 8pt
  // run gets an 8pt band and a 36pt run a 36pt one, stepped, the way Word draws it.
  // Forcing the line's height onto every run instead paints one uniform slab.
  //
  // This only tiles because layout's line height is now the font's own ascent + descent +
  // line gap — the same quantity the browser resolves `normal` to. While the line height
  // came from a multiplier the two disagreed, and the bands either fell short of the next
  // line or lapped it.
  //
  // Set explicitly rather than inherited, so a host page's own line-height cannot change
  // how the document renders.
  element.style.lineHeight = 'normal';
  element.style.whiteSpace = 'pre';
  // A raised superscript or a tall glyph draws outside the line box rather than being
  // clipped at it; the box governs spacing and the selection band, not what is visible.
  element.style.overflow = 'visible';

  // Justified lines carry their slack in the gaps BETWEEN spans. Inline flow has no gaps,
  // so the same slack is reapplied as word spacing rather than being silently dropped.
  const gap = interSpanGap(line);
  if (gap > 0) element.style.wordSpacing = `${gap * scale}px`;

  for (const span of line.spans) element.append(paintSpan(document, span, scale));
  return element;
}

/** The extra space layout put between spans, beyond their own advances. */
function interSpanGap(line: LineRecord): number {
  if (line.spans.length < 2) return 0;
  let total = 0;
  for (let index = 1; index < line.spans.length; index += 1) {
    const previous = line.spans[index - 1]!;
    total += line.spans[index]!.box.x - (previous.box.x + previous.box.width);
  }
  const average = total / (line.spans.length - 1);
  // Sub-pixel noise from measurement is not justification; only a real gap counts.
  return average > 0.25 ? average : 0;
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
    element.append(painted);
  }
  return element;
}

function paintPage(
  document: Document,
  page: PageRecord,
  options: { readonly scale: number; readonly ariaHidden: boolean },
  materialize: boolean
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
  // A page outside the viewport keeps its SIZE and its place, and nothing else. Scroll
  // position and page count stay exactly as they would be with everything built, so
  // scrolling to a page reveals it rather than reflowing the document underneath.
  element.dataset.materialized = String(materialize);
  if (!materialize) return element;

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
  const resolved = {
    scale: options.scale ?? 96 / 72,
    ariaHidden: options.ariaHidden ?? true,
  };
  const document = container.ownerDocument;
  const pages = layout.pages.map((page) =>
    paintPage(document, page, resolved, options.materialize?.has(page.index) ?? true)
  );
  container.dataset.revision = String(layout.revision);
  container.replaceChildren(...pages);
}

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
  TableCellFragmentRecord,
  TableFragmentRecord,
} from '@docx-editor.dev/core-contract/layout';

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
// Unicode-aware: `\w` is ASCII-only, so every CJK family name — 游ゴシック, 맑은 고딕 — failed
// validation and the run silently fell back to the inherited face, losing the typeface of an
// entire document. Quote, backslash, semicolon, comma and control characters stay excluded,
// which is what keeps the quoted CSS string unbreakable.
const FONT_NAME = /^[\p{L}\p{N}\p{M} \-.+_]{1,64}$/u;

/** ST_Underline to the nearest CSS decoration style. */
// MAPS, not object literals. These are indexed by a value that came out of a document, so
// an object literal would answer `constructor` and `__proto__` with something inherited —
// `?? 'solid'` never fires for `constructor`, because a function is not nullish.
const UNDERLINE_STYLE = new Map<string, string>(
  Object.entries({
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
  })
);

const HIGHLIGHT = new Map<string, string>(
  Object.entries({
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
  })
);

type StrikeKind = 'none' | 'single' | 'double';

interface UnderlineDecoration {
  readonly cssStyle: string;
  /** Validated RRGGBB, or null when the underline follows the text colour. */
  readonly color: string | null;
  readonly heavy: boolean;
}

/** `w:dstrike` wins when both strike toggles are present (Word's Font dialog exclusivity). */
function strikeKindOf(style: ResolvedRunStyle): StrikeKind {
  if (style.doubleStrike) return 'double';
  if (style.strike) return 'single';
  return 'none';
}

function underlineHeavy(variant: string): boolean {
  return variant === 'thick' || variant.endsWith('Heavy');
}

function underlineDecorationOf(style: ResolvedRunStyle): UnderlineDecoration | null {
  if (!style.underline) return null;
  const color =
    style.underline.color && HEX.test(style.underline.color) ? style.underline.color : null;
  return {
    cssStyle: UNDERLINE_STYLE.get(style.underline.variant) ?? 'solid',
    color,
    heavy: underlineHeavy(style.underline.variant),
  };
}

/**
 * Apply one CSS text-decoration family to an element.
 *
 * Underline and strike must never share a single `text-decoration-*` declaration when their
 * style, colour or thickness differ — CSS applies those properties to every line on the
 * element. Callers nest independent layers when both families are present.
 */
function applyTextDecoration(
  css: CSSStyleDeclaration,
  line: 'underline' | 'line-through',
  decorationStyle: string,
  options: { color?: string | null; heavy?: boolean; scale: number }
): void {
  css.textDecorationLine = line;
  css.textDecorationStyle = decorationStyle;
  if (options.color) css.textDecorationColor = `#${options.color}`;
  if (options.heavy) {
    // Word's thick / *Heavy underlines are roughly twice a single rule. Floor scales with
    // paint zoom so a 200% surface does not keep a 100%-thin heavy line.
    css.textDecorationThickness = `max(${2 * options.scale}px, 0.12em)`;
  }
}

function applyStrikeDecoration(css: CSSStyleDeclaration, strike: StrikeKind, scale: number): void {
  if (strike === 'none') return;
  applyTextDecoration(css, 'line-through', strike === 'double' ? 'double' : 'solid', { scale });
}

function applyUnderlineDecoration(
  css: CSSStyleDeclaration,
  underline: UnderlineDecoration,
  scale: number
): void {
  applyTextDecoration(css, 'underline', underline.cssStyle, {
    color: underline.color,
    heavy: underline.heavy,
    scale,
  });
}

/**
 * Face / box styles only — decorations are applied separately so underline and strike can
 * live on independent nested layers without sharing style/colour/thickness.
 */
function applyRunFaceStyle(element: HTMLElement, style: ResolvedRunStyle, scale: number): void {
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
  const highlight = style.highlight ? HIGHLIGHT.get(style.highlight) : undefined;
  if (highlight) {
    css.backgroundColor = highlight;
    // Marked so dark mode can counter-invert it: a highlight keeps its authored colour in
    // Word, and the lightness inversion turns yellow into a near-black bar.
    element.dataset.highlight = style.highlight ?? '';
  } else if (style.shading && HEX.test(style.shading)) {
    // Highlight overrides character shading; only paint `w:shd` when no recognised highlight.
    css.backgroundColor = `#${style.shading}`;
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
}

/**
 * Mount glyph text under the correct decoration layer(s).
 *
 * The outer layout-run keeps geometry, model range, highlight and shading. When underline
 * and strike both apply, nested inert spans each own one decoration family so CSS cannot
 * leak `text-decoration-style` / colour / thickness across them.
 */
function mountRunText(
  document: Document,
  run: HTMLElement,
  text: string,
  style: ResolvedRunStyle,
  scale: number
): void {
  const underline = underlineDecorationOf(style);
  const strike = strikeKindOf(style);
  let host: HTMLElement = run;

  if (underline && strike !== 'none') {
    const underlineLayer = document.createElement('span');
    underlineLayer.dataset.docxDeco = 'underline';
    applyUnderlineDecoration(underlineLayer.style, underline, scale);
    const strikeLayer = document.createElement('span');
    strikeLayer.dataset.docxDeco = 'strike';
    applyStrikeDecoration(strikeLayer.style, strike, scale);
    underlineLayer.append(strikeLayer);
    run.append(underlineLayer);
    host = strikeLayer;
  } else if (underline) {
    applyUnderlineDecoration(run.style, underline, scale);
  } else if (strike !== 'none') {
    applyStrikeDecoration(run.style, strike, scale);
  }

  host.textContent = text; // SAFE: textContent, never innerHTML
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
  element.className = 'layout-run layout-run-text';
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
  applyRunFaceStyle(element, span.style, scale);
  // Layout owns advances that the browser cannot reconstruct: horizontal scaling (transform
  // does not reserve space) and OOXML tab stops (`\t` would otherwise paint as a narrow
  // native tab). Both must take the published box width so following runs start where
  // breakParagraph placed them — body, cells, and headers/footers share this painter.
  if (span.style.horizontalScalePercent !== 100 || span.text === '\t') {
    element.style.width = `${span.box.width * scale}px`;
  }
  if (span.text === '\t') {
    // Keep the model character for range mapping, but clip any native tab ink that would
    // spill past the reserved advance.
    element.style.overflow = 'hidden';
  }
  mountRunText(document, element, span.text, span.style, scale);
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
  element.className = 'docx-line layout-line';
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
  // Kill the anonymous line strut that inherits the host page's 16px font-size. That strut
  // shoved baseline-aligned inline-block runs a couple of pixels down, so character shading
  // / highlight backgrounds sat below the paragraph shading band (which uses line-box
  // geometry). `font-size: 0` removes the strut; the published line height is applied as an
  // explicit pixel line-height. Child runs keep their own font sizes and `vertical-align:
  // baseline`, so mixed-size and superscript/subscript (relative offset) still work.
  element.style.fontSize = '0';
  element.style.lineHeight = `${line.box.height * scale}px`;
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
  element.className = 'docx-paragraph-fragment layout-paragraph';
  element.dataset.paragraphId = fragment.paragraphId;
  element.dataset.fragmentIndex = String(fragment.fragmentIndex);
  // Fragment box remains the flow/hit region (includes before/after spacing). Paragraph
  // shading paints from the published line-area box — never the outer fragment background.
  if (fragment.shading && HEX.test(fragment.shading) && fragment.shadingBox) {
    element.append(paintParagraphShading(document, fragment, scale));
  }
  // List markers are layout furniture inside the hanging indent — never model text.
  if (fragment.marker) {
    element.append(paintListMarker(document, fragment, scale));
  }
  for (const line of fragment.lines) {
    const painted = paintLine(document, line, scale);
    // Line boxes are page-relative; inside a fragment they are drawn relative to it —
    // BOTH axes. The fragment box already carries the x origin (indent, or a table cell's
    // content edge), so an absolute left here would count that origin twice.
    painted.style.top = `${(line.box.y - fragment.box.y) * scale}px`;
    const left = line.spans[0]?.box.x ?? line.box.x;
    painted.style.left = `${(left - fragment.box.x) * scale}px`;
    element.append(painted);
  }
  if (fragment.bottomBorder) {
    element.append(paintBottomBorder(document, fragment, scale));
  }
  return element;
}

/**
 * Paint a list marker from layout-published geometry.
 *
 * Inert to editing/selection (`data-docx-marker`), same exclusion class as header/footer
 * furniture. Text is `textContent` only; face styles come from the resolved marker style.
 */
function paintListMarker(
  document: Document,
  fragment: ParagraphFragmentRecord,
  scale: number
): HTMLElement {
  const marker = fragment.marker!;
  const element = positioned(document, 'span', marker.box, scale);
  element.className = 'docx-list-marker';
  element.dataset.docxMarker = '';
  element.setAttribute('contenteditable', 'false');
  element.setAttribute('aria-hidden', 'true');
  element.style.left = `${(marker.box.x - fragment.box.x) * scale}px`;
  element.style.top = `${(marker.box.y - fragment.box.y) * scale}px`;
  element.style.display = 'block';
  element.style.overflow = 'visible';
  element.style.whiteSpace = 'pre';
  applyRunFaceStyle(element, marker.style, scale);
  mountRunText(document, element, marker.text, marker.style, scale);
  return element;
}

/**
 * Paint paragraph shading from layout-published geometry.
 *
 * Height/position come from `shadingBox` (line union) — not from fragment outer height or
 * computed style. Colour is re-validated at the sink like every other file-derived fill.
 */
function paintParagraphShading(
  document: Document,
  fragment: ParagraphFragmentRecord,
  scale: number
): HTMLElement {
  const box = fragment.shadingBox!;
  const band = positioned(document, 'div', box, scale);
  band.className = 'docx-paragraph-shading';
  band.setAttribute('aria-hidden', 'true');
  band.style.left = `${(box.x - fragment.box.x) * scale}px`;
  band.style.top = `${(box.y - fragment.box.y) * scale}px`;
  band.style.backgroundColor = `#${fragment.shading}`;
  return band;
}

/**
 * Paint the bottom paragraph rule from layout geometry.
 *
 * Height, colour and position come from the record — never from computed style or
 * getBoundingClientRect. Colour is re-validated at the sink like every other file-derived
 * style value.
 */
function paintBottomBorder(
  document: Document,
  fragment: ParagraphFragmentRecord,
  scale: number
): HTMLElement {
  const border = fragment.bottomBorder!;
  const rule = positioned(document, 'div', border.box, scale);
  rule.className = 'docx-paragraph-border docx-paragraph-border-bottom';
  rule.setAttribute('aria-hidden', 'true');
  rule.style.left = `${(border.box.x - fragment.box.x) * scale}px`;
  rule.style.top = `${(border.box.y - fragment.box.y) * scale}px`;
  // Height already set by `positioned` from the published box; colour is the only extra.
  const color = border.edge.color && HEX.test(border.edge.color) ? border.edge.color : '000000';
  rule.style.backgroundColor = `#${color}`;
  // `val` selects a CSS approximation; unknown styles fall back to a solid rule so a
  // recognised thickness is never silently dropped.
  switch (border.edge.val) {
    case 'dashed':
    case 'dashSmallGap':
      rule.style.backgroundImage = `linear-gradient(to right, #${color} 60%, transparent 60%)`;
      rule.style.backgroundSize = `${Math.max(4, 4 * scale)}px 100%`;
      break;
    case 'dotted':
      rule.style.backgroundImage = `linear-gradient(to right, #${color} 35%, transparent 35%)`;
      rule.style.backgroundSize = `${Math.max(3, 3 * scale)}px 100%`;
      break;
    case 'double': {
      // Two hairlines inside the published box height — still layout-owned geometry.
      const half = Math.max(1, (border.box.height * scale) / 3);
      rule.style.backgroundColor = 'transparent';
      rule.style.borderTop = `${half}px solid #${color}`;
      rule.style.borderBottom = `${half}px solid #${color}`;
      rule.style.boxSizing = 'border-box';
      break;
    }
    default:
      break;
  }
  return rule;
}

import { applyCellBorders } from './semantic-paint-table-borders.ts';

function paintTableCell(
  document: Document,
  cell: TableCellFragmentRecord,
  rowBox: { readonly x: number; readonly y: number },
  scale: number
): HTMLElement {
  const cellElement = positioned(document, 'div', cell.box, scale);
  cellElement.className = 'docx-table-cell';
  cellElement.style.left = `${(cell.box.x - rowBox.x) * scale}px`;
  cellElement.style.top = `${(cell.box.y - rowBox.y) * scale}px`;
  cellElement.style.boxSizing = 'border-box';
  cellElement.style.overflow = 'visible';
  if (cell.rowSpan && cell.rowSpan > 1) {
    cellElement.dataset.rowSpan = String(cell.rowSpan);
  }

  // Continuation cells stay in the tree for grid bookkeeping but paint nothing.
  if (cell.paintInert || cell.vMergeContinue) {
    cellElement.dataset.vMergeContinue = 'true';
    cellElement.style.border = 'none';
    cellElement.style.backgroundColor = 'transparent';
    return cellElement;
  }

  cellElement.style.border = 'none';
  applyCellBorders(document, cellElement, cell.borders, scale);

  // Re-validated at the sink, like every other file-derived style value here.
  if (cell.shading && HEX.test(cell.shading)) {
    cellElement.style.backgroundColor = `#${cell.shading}`;
  }
  for (const block of cell.blocks) {
    const painted =
      block.kind === 'table'
        ? paintTableFragment(document, block, scale)
        : paintFragment(document, block, scale);
    painted.style.left = `${(block.box.x - cell.box.x) * scale}px`;
    painted.style.top = `${(block.box.y - cell.box.y) * scale}px`;
    cellElement.append(painted);
  }
  return cellElement;
}

/**
 * One painted table fragment: positioned row and cell boxes, layout-owned per-edge borders
 * and validated shading, and the cell's blocks recursing into the ordinary painters —
 * which is what gives cell text the same `data-paragraph-id`/`data-start` attributes as
 * body text, so selection and the caret work inside cells with no extra wiring.
 */
function paintTableFragment(
  document: Document,
  fragment: TableFragmentRecord,
  scale: number
): HTMLElement {
  const element = positioned(document, 'div', fragment.box, scale);
  element.className = 'docx-table-fragment layout-table';
  element.dataset.tableId = fragment.tableId;
  element.dataset.fragmentIndex = String(fragment.fragmentIndex);
  element.style.overflow = 'visible';
  for (const row of fragment.rows) {
    const rowElement = positioned(document, 'div', row.box, scale);
    rowElement.className = 'docx-table-row';
    rowElement.dataset.rowId = row.id;
    if (row.isHeaderRepeat) rowElement.dataset.headerRepeat = 'true';
    rowElement.style.left = `${(row.box.x - fragment.box.x) * scale}px`;
    rowElement.style.top = `${(row.box.y - fragment.box.y) * scale}px`;
    rowElement.style.overflow = 'visible';
    for (const cell of row.cells) {
      rowElement.append(paintTableCell(document, cell, row.box, scale));
    }
    element.append(rowElement);
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
  // Deliberately NOT `layout-page`: that class carries the legacy lane's whole-frame
  // inversion, which would flip the paper itself. The sheet keeps the canvas colour its
  // token names and only `.docx-page-content` below is inverted, so the theme and print
  // rules name that class instead.
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
    content.append(
      fragment.kind === 'table'
        ? paintTableFragment(document, fragment, options.scale)
        : paintFragment(document, fragment, options.scale)
    );
  }
  element.append(content);

  // Page furniture (phase 2, read-only): painted inside the sheet but OUTSIDE the content
  // box, inert to editing. `data-docx-hf` is what dom-selection uses to refuse mapping a
  // browser caret inside the furniture back to a model position.
  for (const story of [page.header, page.footer]) {
    if (!story) continue;
    const container = document.createElement('div');
    container.className = 'docx-hf';
    container.dataset.docxHf = story.kind;
    container.setAttribute('contenteditable', 'false');
    container.style.position = 'absolute';
    container.style.left = `${(story.box.x - page.box.x) * options.scale}px`;
    container.style.top = `${(story.box.y - page.box.y) * options.scale}px`;
    container.style.width = `${story.box.width * options.scale}px`;
    container.style.height = `${story.box.height * options.scale}px`;
    container.style.overflow = 'hidden';
    for (const fragment of story.fragments) {
      container.append(
        fragment.kind === 'table'
          ? paintTableFragment(document, fragment, options.scale)
          : paintFragment(document, fragment, options.scale)
      );
    }
    element.append(container);
  }
  return element;
}

/**
 * One painted page, retained so an unchanged page never has to be rebuilt.
 *
 * Incremental layout keeps the RECORD of an untouched page identical across revisions —
 * same object, by design — so record identity is a complete reuse test: same record, same
 * materialization, same paint parameters means the element in hand is already exactly what
 * this pass would build. Rebuilding every sheet per commit made the browser restyle the
 * whole document on each keystroke, which at several hundred pages cost more than layout
 * and paint together.
 */
interface RetainedPage {
  readonly record: PageRecord;
  readonly materialized: boolean;
  readonly element: HTMLElement;
}

interface RetainedPaint {
  /** Paint parameters folded into reuse: a zoom or a11y change rebuilds every page. */
  readonly parameters: string;
  readonly pages: readonly RetainedPage[];
}

const retainedPaints = new WeakMap<HTMLElement, RetainedPaint>();

/**
 * Paint a whole layout into a container, reusing the pages that did not change.
 *
 * The DOM is built with `createElement` and `textContent` only — no file-derived string is
 * ever parsed as markup — and stray children (nothing this module painted) are removed, so
 * the container's content is always exactly the painted pages.
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
  const parameters = `${resolved.scale}|${resolved.ariaHidden}`;
  const previous = retainedPaints.get(container);
  const reusable =
    previous && previous.parameters === parameters
      ? new Map(previous.pages.map((entry) => [entry.record, entry]))
      : null;

  const pages: RetainedPage[] = layout.pages.map((page) => {
    const materialized = options.materialize?.has(page.index) ?? true;
    const kept = reusable?.get(page);
    if (kept && kept.materialized === materialized) return kept;
    return {
      record: page,
      materialized,
      element: paintPage(document, page, resolved, materialized),
    };
  });
  retainedPaints.set(container, { parameters, pages });
  container.dataset.revision = String(layout.revision);

  // Keyed reconcile instead of `replaceChildren`: retained elements stay where they are —
  // keeping the browser's style and layout for them, and the DOM selection anchored inside
  // them — while changed pages are placed in order and anything else is dropped.
  const kept = new Set<HTMLElement>(pages.map((entry) => entry.element));
  let cursor = container.firstChild;
  for (const entry of pages) {
    if (entry.element === cursor) {
      cursor = cursor.nextSibling;
      continue;
    }
    container.insertBefore(entry.element, cursor);
  }
  let child = container.firstChild;
  while (child) {
    const next = child.nextSibling;
    // A membership test, not an `instanceof`: it treats a node from any realm — and any
    // non-element node — the same way, and everything this pass did not paint goes.
    if (!kept.has(child as HTMLElement)) (child as ChildNode).remove();
    child = next;
  }
}

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
  TableFragmentRecord,
} from '@docx-editor.dev/core-contract/layout';

/**
 * What the run painters need beyond the records: the pixel scale, and the optional
 * family-alias lookup that lets embedded fonts paint without their file-declared family
 * name entering the page-global CSS font namespace.
 */
export interface PaintContext {
  readonly scale: number;
  /**
   * Maps a document-declared family to the alias the host registered its bytes under, or
   * `undefined` when that family has no aliased face. Engine-minted values only.
   */
  readonly fontAlias?: (family: string) => string | undefined;
}

/**
 * A stable per-function token so the paint-reuse key can tell one alias lookup from
 * another. Identity is what matters (a new lookup means new fonts); the value is opaque.
 */
const aliasTokens = new WeakMap<object, string>();
let nextAliasToken = 0;
function aliasIdentity(alias: (family: string) => string | undefined): string {
  let token = aliasTokens.get(alias);
  if (!token) {
    nextAliasToken += 1;
    token = `alias${nextAliasToken}`;
    aliasTokens.set(alias, token);
  }
  return token;
}

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
  /**
   * Family-alias lookup for fonts the host registered on behalf of THIS document (see
   * {@link PaintContext.fontAlias}). Painted runs emit the alias ahead of the declared
   * family, so a file can never shadow a family name the host page uses.
   */
  readonly fontAlias?: (family: string) => string | undefined;
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

/** Apply a resolved run style to an element, value by validated value. */
function applyRunStyle(element: HTMLElement, style: ResolvedRunStyle, ctx: PaintContext): void {
  const css = element.style;
  const scale = ctx.scale;
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
    // An alias names bytes the host registered for THIS document under a family a file
    // cannot collide with. It leads, with the declared family behind it: document text
    // gets the embedded glyphs while the page-global CSS font namespace keeps its own
    // meaning for the declared name. `FONT_NAME` gates the declared family; the alias is
    // engine-minted, never file-derived.
    const alias = ctx.fontAlias?.(style.fontFamily);
    css.fontFamily = alias ? `"${alias}", "${style.fontFamily}"` : `"${style.fontFamily}"`;
  }
  if (style.color && HEX.test(style.color)) css.color = `#${style.color}`;
  const highlight = style.highlight ? HIGHLIGHT.get(style.highlight) : undefined;
  if (highlight) {
    css.backgroundColor = highlight;
    // Marked so dark mode can counter-invert it: a highlight keeps its authored colour in
    // Word, and the lightness inversion turns yellow into a near-black bar.
    element.dataset.highlight = style.highlight ?? '';
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
      css.textDecorationStyle = UNDERLINE_STYLE.get(style.underline.variant) ?? 'solid';
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

function paintSpan(document: Document, span: StyleSpanRecord, ctx: PaintContext): HTMLElement {
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
  applyRunStyle(element, span.style, ctx);
  if (span.style.horizontalScalePercent !== 100) {
    // The transform stretches the glyphs but reserves nothing, so the element is given the
    // advance layout already scaled. Without it the stretched run painted over its
    // neighbour and their selection bands overlapped.
    element.style.width = `${span.box.width * ctx.scale}px`;
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
function paintLine(document: Document, line: LineRecord, ctx: PaintContext): HTMLElement {
  const scale = ctx.scale;
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

  for (const span of line.spans) element.append(paintSpan(document, span, ctx));
  // A span-less line (empty paragraph) has no inline content, and a browser will not
  // draw a caret at a position with no inline box to measure. The <br> is the anchor;
  // sizing it to the line keeps the caret the paragraph's font height, not the div's
  // default.
  if (line.spans.length === 0) {
    const anchor = document.createElement('br');
    anchor.style.lineHeight = `${line.box.height * scale}px`;
    element.append(anchor);
  }
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
  ctx: PaintContext
): HTMLElement {
  const scale = ctx.scale;
  const element = positioned(document, 'div', fragment.box, scale);
  element.className = 'docx-paragraph-fragment layout-paragraph';
  element.dataset.paragraphId = fragment.paragraphId;
  element.dataset.fragmentIndex = String(fragment.fragmentIndex);
  for (const line of fragment.lines) {
    const painted = paintLine(document, line, ctx);
    // Line boxes are page-relative; inside a fragment they are drawn relative to it —
    // BOTH axes. The fragment box already carries the x origin (indent, or a table cell's
    // content edge), so an absolute left here would count that origin twice.
    painted.style.top = `${(line.box.y - fragment.box.y) * scale}px`;
    const left = line.spans[0]?.box.x ?? line.box.x;
    painted.style.left = `${(left - fragment.box.x) * scale}px`;
    element.append(painted);
  }
  return element;
}

/**
 * One painted table fragment: positioned row and cell boxes, a 1px black border and the
 * validated shading per cell (the legacy rect's `stroke: '000000'`/`fill`), and the cell's
 * blocks recursing into the ordinary painters — which is what gives cell text the same
 * `data-paragraph-id`/`data-start` attributes as body text, so selection and the caret
 * work inside cells with no extra wiring.
 */
function paintTableFragment(
  document: Document,
  fragment: TableFragmentRecord,
  ctx: PaintContext
): HTMLElement {
  const scale = ctx.scale;
  const element = positioned(document, 'div', fragment.box, scale);
  element.className = 'docx-table-fragment layout-table';
  element.dataset.tableId = fragment.tableId;
  element.dataset.fragmentIndex = String(fragment.fragmentIndex);
  for (const row of fragment.rows) {
    const rowElement = positioned(document, 'div', row.box, scale);
    rowElement.className = 'docx-table-row';
    rowElement.dataset.rowId = row.id;
    if (row.isHeaderRepeat) rowElement.dataset.headerRepeat = 'true';
    rowElement.style.left = `${(row.box.x - fragment.box.x) * scale}px`;
    rowElement.style.top = `${(row.box.y - fragment.box.y) * scale}px`;
    for (const cell of row.cells) {
      const cellElement = positioned(document, 'div', cell.box, scale);
      cellElement.className = 'docx-table-cell';
      cellElement.style.left = `${(cell.box.x - row.box.x) * scale}px`;
      cellElement.style.top = `${(cell.box.y - row.box.y) * scale}px`;
      cellElement.style.boxSizing = 'border-box';
      cellElement.style.border = '1px solid #000000';
      // Re-validated at the sink, like every other file-derived style value here.
      if (cell.shading && HEX.test(cell.shading)) {
        cellElement.style.backgroundColor = `#${cell.shading}`;
      }
      for (const block of cell.blocks) {
        const painted =
          block.kind === 'table'
            ? paintTableFragment(document, block, ctx)
            : paintFragment(document, block, ctx);
        painted.style.left = `${(block.box.x - cell.box.x) * scale}px`;
        painted.style.top = `${(block.box.y - cell.box.y) * scale}px`;
        cellElement.append(painted);
      }
      rowElement.append(cellElement);
    }
    element.append(rowElement);
  }
  return element;
}

function paintPage(
  document: Document,
  page: PageRecord,
  options: PaintContext & { readonly ariaHidden: boolean },
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
        ? paintTableFragment(document, fragment, options)
        : paintFragment(document, fragment, options)
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
    // The box IS the flow height; anything drawn beyond it must not extend the hit area.
    container.style.overflow = 'hidden';
    for (const fragment of story.fragments) {
      container.append(
        fragment.kind === 'table'
          ? paintTableFragment(document, fragment, options)
          : paintFragment(document, fragment, options)
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
    ...(options.fontAlias ? { fontAlias: options.fontAlias } : {}),
  };
  const document = container.ownerDocument;
  // The alias lookup is part of the paint parameters: a page painted before fonts
  // registered must not be reused verbatim afterwards.
  const parameters = `${resolved.scale}|${resolved.ariaHidden}|${resolved.fontAlias ? aliasIdentity(resolved.fontAlias) : ''}`;
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

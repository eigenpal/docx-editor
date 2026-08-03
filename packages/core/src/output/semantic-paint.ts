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

import { baselineShiftPtOf, TAB_LEADER_GLYPH } from '@docx-editor.dev/core-contract/layout';
import { authorSlotsOf, revisionPresentationOf } from './revision-presentation.ts';
import type {
  LineRecord,
  PageRecord,
  ParagraphBorderStrokeRecord,
  ParagraphFragmentRecord,
  ResolvedRunStyle,
  SemanticLayout,
  SpanLinkRecord,
  StyleSpanRecord,
  TableCellFragmentRecord,
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
  /**
   * Paint hyperlinks without an `href` and out of the tab order.
   *
   * Set while painting page furniture: headers and footers are read-only in this slice, so
   * a live link there would be the one thing in the furniture that answers a gesture.
   */
  readonly inertLinks?: boolean;
  /**
   * Author to colour slot, by order of first appearance across the whole document.
   *
   * Resolved once per paint rather than per span: the order is a property of the document, and
   * deriving it per page would give the same author different colours on different sheets.
   */
  readonly authorSlots?: ReadonlyMap<string, number>;
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
function applyRunFaceStyle(element: HTMLElement, style: ResolvedRunStyle, ctx: PaintContext): void {
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
  const shiftPt = baselineShiftPtOf(style);
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

/**
 * Draw a span as the tracked change it is.
 *
 * Applied to the run BOX rather than the inner text layers: `w:u` and `w:strike` already own
 * those, and a revision's decoration is a second, independent statement about the same glyphs.
 * Word draws both — struck-through text that was also underlined by its author keeps both rules.
 *
 * The colour lands as a custom property on the element rather than a resolved value, so a host
 * restyling `--doc-review-author-N` under `.ep-root` changes the painted document with it.
 *
 * The dataset attributes are the review surface's join key: a card can find its own text, and
 * the active-item highlight is set by attribute rather than by building a CSS rule out of an
 * id — comment and revision metadata are attacker-controlled.
 */
function applyRevisionPresentation(
  element: HTMLElement,
  span: StyleSpanRecord,
  ctx: PaintContext
): void {
  const presentation = revisionPresentationOf(span.revisions, ctx.authorSlots);
  if (!presentation) return;
  const { attribution } = presentation;
  element.classList.add('docx-revision', `docx-revision-${attribution.kind}`);
  element.dataset.revisionKind = attribution.kind;
  element.dataset.revisionId = attribution.id;
  element.dataset.revisionAuthor = attribution.author;
  if (attribution.date !== undefined) element.dataset.revisionDate = attribution.date;
  element.style.color = presentation.color;
  if (presentation.line) {
    element.style.textDecorationLine = presentation.line;
    element.style.textDecorationStyle = presentation.decorationStyle;
    element.style.textDecorationColor = presentation.color;
  }
}

/**
 * The margin rule beside a line that carries a tracked change.
 *
 * Furniture: no model range, `aria-hidden`, not editable, and it takes no space in the flow —
 * it is positioned in the margin the fragment box already leaves, so it can never push text.
 */
function paintChangeBar(
  document: Document,
  fragment: ParagraphFragmentRecord,
  line: LineRecord,
  scale: number
): HTMLElement {
  const bar = document.createElement('span');
  bar.className = 'docx-change-bar';
  bar.setAttribute('aria-hidden', 'true');
  bar.contentEditable = 'false';
  bar.style.position = 'absolute';
  bar.style.top = `${(line.box.y - fragment.box.y) * scale}px`;
  bar.style.height = `${line.box.height * scale}px`;
  // Left of the text column, in the margin, so it never overlaps a glyph.
  bar.style.left = `${-CHANGE_BAR_OFFSET_PT * scale}px`;
  bar.style.width = `${CHANGE_BAR_WIDTH_PT * scale}px`;
  bar.style.backgroundColor = 'var(--doc-review-change-bar)';
  return bar;
}

/** Distance from the text column to the change bar, and its thickness, in points. */
const CHANGE_BAR_OFFSET_PT = 18;
const CHANGE_BAR_WIDTH_PT = 1.2;

function paintSpan(
  document: Document,
  span: StyleSpanRecord,
  ctx: PaintContext,
  bandHeightPt: number,
  extraLeadingPt: number
): HTMLElement {
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
  // THE BAND IS THE BOX; THE LEADING DECIDES WHERE THE TEXT SITS IN IT.
  //
  // `w:line` above single puts ALL the extra leading ABOVE the text — observed Word
  // behaviour, not a spec rule; 17.3.1.33 defines the VALUES and says nothing about where
  // the leading lands, and `applyLineSpacing` is where that decision is made. So the
  // glyphs sit at the BOTTOM of the line box and `line.baseline` is measured from the line
  // top with the whole leading already added. Sizing the run by `line-height` alone leaves
  // the browser to place the glyphs, and CSS always splits leading in HALF — so the text
  // was painted half a leading ABOVE the baseline layout published, while the caret (which
  // reads `line.baseline`) was drawn on it. On a double-spaced line that is half a line
  // apart, and the insertion point sat under the text instead of in it.
  //
  // So the leading is PADDING, not line-height. The box is the band, the leading is padded
  // off the top of it, and what remains is an inner line box exactly as tall as the glyphs —
  // no half-leading left for CSS to split, and the baseline lands where layout put it.
  //
  // Growing the line-height instead lands the same baseline and is wrong for a reason that
  // does not show up in a geometry test: the browser paints the native selection to the
  // INNER LINE BOX, so a box one leading shorter than its own line-height bled a leading's
  // worth of highlight into the line below. Double-spaced text selected as overlapping
  // stripes, darker where they met, running past the end of the paragraph.
  element.style.boxSizing = 'border-box';
  element.style.height = `${bandHeightPt * ctx.scale}px`;
  element.style.paddingTop = `${extraLeadingPt * ctx.scale}px`;
  element.style.lineHeight = `${(bandHeightPt - extraLeadingPt) * ctx.scale}px`;
  // ADDRESSABLE ONLY IF IT OWNS OFFSETS. Selection maps through `data-paragraph-id` +
  // `data-start` and reads an endpoint as `start + textContent.length`, so a span whose
  // painted text is wider than its model range hands back an offset the paragraph does not
  // have. A `w:ptab` is exactly that — one painted `\t` over a ZERO-WIDTH range — and a
  // click just left of a contents line's page number resolved to the end of the paragraph,
  // the same answer as clicking after it. Zero-width spans paint as furniture instead: the
  // advance and its leader are still drawn, and the mapper resolves through the real text
  // either side. An ordinary `w:tab` keeps its address; it does occupy an offset.
  if (span.range.end > span.range.start) {
    element.dataset.paragraphId = span.range.paragraphId;
    element.dataset.start = String(span.range.start);
    element.dataset.end = String(span.range.end);
  } else {
    element.setAttribute('aria-hidden', 'true');
    element.contentEditable = 'false';
  }
  applyRunFaceStyle(element, span.style, ctx);
  applyRevisionPresentation(element, span, ctx);
  // Layout owns advances that the browser cannot reconstruct: horizontal scaling (transform
  // does not reserve space) and OOXML tab stops (`\t` would otherwise paint as a narrow
  // native tab). Both must take the published box width so following runs start where
  // breakParagraph placed them — body, cells, and headers/footers share this painter.
  if (span.style.horizontalScalePercent !== 100 || span.text === '\t') {
    element.style.width = `${span.box.width * ctx.scale}px`;
  }
  if (span.text === '\t') {
    // Keep the model character for range mapping, but clip any native tab ink that would
    // spill past the reserved advance.
    element.style.overflow = 'hidden';
    // A CLIPPED BOX MUST NOT DECIDE THE LINE'S BASELINE.
    //
    // `overflow: hidden` makes an inline-block's baseline its BOTTOM MARGIN EDGE
    // (CSS 2.1 §10.8.1) instead of the baseline of its text. Left baseline-aligned, the
    // tab therefore asked the line box for its whole band above the baseline — more than
    // any glyph run asks for, since a run only needs its ascent — so the browser pushed
    // the common baseline down to satisfy it and every word on the line dropped with it.
    // On a tabbed line that put the text ~3.4px below where layout published the baseline,
    // and the tab leader (its own layer, correctly baselined) then read as floating above
    // the text it was supposed to sit level with. Aligning the tab to the line box top
    // takes it out of the baseline calculation entirely; the box still clips, and its top
    // is exactly where a baseline-aligned run of the same band lands anyway.
    element.style.verticalAlign = 'top';
  }
  mountRunText(document, element, span.text, span.style, ctx.scale);
  return element;
}

/**
 * The anchor element wrapping one line's worth of a hyperlink's runs.
 *
 * FURNITURE, NEVER AUTHORITY. It carries semantics the run spans cannot — `href`, `title`,
 * a focus stop, the "link" role assistive technology announces — and nothing else. Selection
 * mapping, hit-testing and the caret all read the `data-paragraph-id`/`data-start`/
 * `data-end` on the spans INSIDE it, exactly as they do for plain text, so an anchor can be
 * added or removed without any of them changing behaviour.
 *
 * `href` is the SANITIZED projection layout already produced, never the authored target. A
 * link whose scheme was refused, whose relationship is missing, or that sits in read-only
 * page furniture gets no `href` at all: it still paints, still selects, still saves, and
 * there is no attribute for a click or a keyboard activation to follow.
 */
function paintHyperlinkAnchor(
  document: Document,
  link: SpanLinkRecord,
  ctx: PaintContext
): HTMLElement {
  const element = document.createElement('a');
  element.className = 'docx-hyperlink';
  // The link's identity, so a click can name the `w:hyperlink` it landed on without the
  // pointer path re-deriving it from geometry.
  element.dataset.docxLink = link.id;
  element.dataset.docxLinkKind = link.kind;
  // NEVER A FOCUS TARGET. The pages layer is the surface's single focus host — a
  // contenteditable spanning the whole document — and an `<a>` inside it is a competing one.
  // Chrome focuses an anchor on mousedown, the pointer path then focuses the pages layer
  // back, and re-focusing an element tens of thousands of pixels tall scrolls the viewport
  // to its TOP: clicking a link on page 10 threw the reader back to page 1.
  //
  // Nothing is lost by taking it out of the tab order, because tabbing was never how a link
  // is reached here: the caret is, and Ctrl/Cmd+K opens the popover on the link the caret is
  // in. That is Word's model rather than a browser's tab-through-links model, and it is the
  // one the rest of this surface already implements.
  element.setAttribute('tabindex', '-1');
  // Inert furniture links (headers and footers) are not activation targets either: header
  // editing is a later slice, so a live `href` there would be the one part of the furniture
  // that responds to a click.
  if (!ctx.inertLinks && link.href) {
    // SAFE: `setAttribute`, and the value is the allowlisted projection from `sanitizeHref`
    // — `javascript:`/`data:`/`vbscript:`/`file:` never reach here.
    element.setAttribute('href', link.href);
    // A same-page bookmark jump is handled by the engine; an external target is opened only
    // through the popover. Either way the browser must not navigate on its own, which the
    // surface enforces — this is belt and braces for the print and clipboard paths, where
    // the anchor leaves the editable surface entirely.
    if (link.kind === 'external') element.setAttribute('rel', 'noopener noreferrer');
  }
  // `w:tooltip` is Word's hover text. `title` takes a plain string, not markup.
  if (link.tooltip) element.setAttribute('title', link.tooltip);
  // SHRINK-WRAPPED, BASELINE-ALIGNED — the same box model the runs inside it use.
  //
  // A plain `display: inline` anchor measures ZERO HIGH here: the line is a `font-size: 0`
  // flow, so the inline box's own height is nothing and its rect never grows to cover the
  // inline-block runs within it. A person could still click the link (the run takes the
  // click and it bubbles), but nothing that MEASURES could: automation refused it as
  // invisible, and accessibility and hit-testing saw a link with no extent.
  //
  // `inline-block` gives it a box that shrink-wraps its children; `vertical-align: baseline`
  // keeps that box on the same baseline they were already on, because an inline-block's
  // baseline is its last line box's — the children's. Layout is unchanged and the element is
  // now real.
  element.style.display = 'inline-block';
  element.style.verticalAlign = 'baseline';
  // Decoration and colour stay with the RUNS, which carry the resolved `Hyperlink` character
  // style. Imposing them here would overrule an authored override.
  element.style.textDecoration = 'none';
  element.style.color = 'inherit';
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

  // Per-run band heights, chosen so the browser's line-box math cannot move a glyph:
  // the tallest run's band is exactly the line height — the same value every run
  // inherited before — so the box that decides where the common baseline sits is
  // unchanged. Smaller runs get their own published height plus the line's extra
  // leading (spacing above single keeps a contiguous band, as Word draws it), capped
  // at the line height so an `exact`-spaced line cannot grow past its box.
  //
  // The leading is READ, not recovered from the box. The marker and the tab leader place
  // their furniture against this same number, and when each of the three derived it for
  // itself they drifted: the text moved onto the published baseline while the marker
  // beside it stayed half a leading higher.
  const leading = line.leading ?? 0;
  // Consecutive spans of the SAME link share one anchor, so a link that spans several
  // formatting runs on one line is one `<a>` — one focus stop, one hover target, one thing
  // a screen reader announces. A link that WRAPS gets one anchor per line, which is the
  // only shape an absolutely-positioned line model can express.
  let anchor: HTMLElement | null = null;
  let anchorLinkId: string | null = null;
  for (const span of line.spans) {
    const band = Math.min(span.box.height + leading, line.box.height);
    const painted = paintSpan(document, span, ctx, band, leading);
    const link = span.link;
    if (!link) {
      anchor = null;
      anchorLinkId = null;
      element.append(painted);
      continue;
    }
    if (!anchor || anchorLinkId !== link.id) {
      anchor = paintHyperlinkAnchor(document, link, ctx);
      anchorLinkId = link.id;
      element.append(anchor);
    }
    anchor.append(painted);
  }
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
  // Fragment box remains the flow/hit region (includes before/after spacing). Paragraph
  // shading paints from the published line-area box — never the outer fragment background.
  if (fragment.shading && HEX.test(fragment.shading) && fragment.shadingBox) {
    element.append(paintParagraphShading(document, fragment, scale));
  }
  // List markers are layout furniture inside the hanging indent — never model text.
  if (fragment.marker) {
    element.append(paintListMarker(document, fragment, ctx));
  }
  // Tab leaders are furniture too, and they are painted BEFORE the lines so the glyphs sit
  // behind the text rather than over it.
  for (const line of fragment.lines) {
    for (const span of line.spans) {
      if (!span.tabLeader) continue;
      const leader = paintTabLeader(document, fragment, line, span, ctx);
      if (leader) element.append(leader);
    }
  }
  for (const line of fragment.lines) {
    // CHANGE BAR. Word draws a rule in the margin beside every line a revision touches, and it
    // is the only signal that a change exists at all once the reader is looking at a resolved
    // view. Derived from the painted spans rather than a layout field: whether a line carries
    // tracked text is exactly "does any span on it have an attribution", and asking here keeps
    // the bar in step with what was actually drawn.
    if (line.spans.some((span) => span.revisions !== undefined && span.revisions.length > 0)) {
      element.append(paintChangeBar(document, fragment, line, scale));
    }
    const painted = paintLine(document, line, ctx);
    // Line boxes are page-relative; inside a fragment they are drawn relative to it —
    // BOTH axes. The fragment box already carries the x origin (indent, or a table cell's
    // content edge), so an absolute left here would count that origin twice.
    painted.style.top = `${(line.box.y - fragment.box.y) * scale}px`;
    const left = line.spans[0]?.box.x ?? line.box.x;
    painted.style.left = `${(left - fragment.box.x) * scale}px`;
    element.append(painted);
  }
  // Layout owns border geometry. Side rules sit OUTSIDE the text column — Word draws them
  // there and never reflows the text for them — so a painter deriving an edge from the
  // fragment box would put the frame through the words.
  if (fragment.borders) {
    for (const stroke of fragment.borders) {
      element.append(paintParagraphBorder(document, fragment, stroke, scale));
    }
  } else if (fragment.bottomBorder) {
    // Table-cell paragraphs still publish the bottom rule alone.
    element.append(
      paintParagraphBorder(
        document,
        fragment,
        { side: 'bottom', edge: fragment.bottomBorder.edge, box: fragment.bottomBorder.box },
        scale
      )
    );
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
  ctx: PaintContext
): HTMLElement {
  const marker = fragment.marker!;
  const scale = ctx.scale;
  // The marker belongs to the paragraph's FIRST line, which is the line it is drawn beside.
  const leading = fragment.lines[0]?.leading ?? 0;
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
  // The marker sits on the FIRST LINE'S BASELINE, not at the top of its box.
  //
  // Painting the glyph directly into this block let it inherit the block's own default
  // line-height at the marker's font size, so a `1.` in a smaller marker face landed
  // below the text it numbers and a bullet floated above it. The same treatment
  // `paintLine` gives a line fixes it: kill the anonymous strut with `font-size: 0`,
  // apply the published box height as an explicit line-height, and let the glyph align on
  // `baseline` inside it — which is exactly how every run on that line is aligned.
  //
  // INCLUDING THE LEADING. `marker.box.height` is the whole post-spacing line box, so on a
  // spaced line the glyph would centre in it while the text it numbers is bottom-anchored,
  // and the number floated half a leading above its own sentence. The run treatment is the
  // whole treatment: an inner line box one leading taller drops the glyph onto the same
  // baseline `paintSpan` puts the text on.
  element.style.fontSize = '0';
  element.style.lineHeight = `${marker.box.height * scale}px`;
  const glyph = document.createElement('span');
  glyph.style.display = 'inline-block';
  glyph.style.verticalAlign = 'baseline';
  glyph.style.height = `${marker.box.height * scale}px`;
  glyph.style.lineHeight = `${(marker.box.height + leading) * scale}px`;
  applyRunFaceStyle(glyph, marker.style, ctx);
  mountRunText(document, glyph, marker.text, marker.style, scale);
  element.append(glyph);
  return element;
}

/**
 * ST_TabTlc (ECMA-376 §17.3.1.38) to the glyph Word repeats across the tab.
 *
 * A Map, not an object literal, for the same reason as the decoration tables: the key comes
 * out of a document and an object literal answers `constructor` with a function.
 * `heavy` has no separate character — Word draws a thicker rule, approximated by the
 * underscore in the run's own face at bold weight rather than by inventing a font.
 */

/**
 * Ceiling on repeated leader glyphs for one tab.
 *
 * The repeat count is derived from a layout width and a resolved font size — both bounded —
 * but this is still a `.repeat()` bound, so it gets an explicit cap rather than trusting the
 * arithmetic upstream of it. `overflow: hidden` trims whatever the cap leaves over.
 */
const MAX_TAB_LEADER_GLYPHS = 512;

/**
 * Paint the leader of one tab across the advance layout already reserved for it.
 *
 * Inert furniture (`data-docx-tab-leader`), the same class as list markers: it carries no
 * source range, so it can never be selected, copied or serialised. Critically it is NOT a
 * child of the tab span — `dom-selection` reads a span's length from its `textContent`, and
 * a hundred dots inside the `\t` run would make every offset after it wrong.
 */
function paintTabLeader(
  document: Document,
  fragment: ParagraphFragmentRecord,
  line: LineRecord,
  span: StyleSpanRecord,
  ctx: PaintContext
): HTMLElement | null {
  const glyph = span.tabLeader ? TAB_LEADER_GLYPH.get(span.tabLeader) : undefined;
  if (!glyph || span.box.width <= 0) return null;
  const scale = ctx.scale;

  const layer = document.createElement('div');
  layer.className = 'docx-tab-leader';
  layer.dataset.docxTabLeader = '';
  layer.setAttribute('contenteditable', 'false');
  layer.setAttribute('aria-hidden', 'true');
  layer.style.position = 'absolute';
  layer.style.left = `${(span.box.x - fragment.box.x) * scale}px`;
  layer.style.top = `${(line.box.y - fragment.box.y) * scale}px`;
  layer.style.width = `${span.box.width * scale}px`;
  layer.style.height = `${line.box.height * scale}px`;
  layer.style.overflow = 'hidden';
  layer.style.whiteSpace = 'pre';
  layer.style.pointerEvents = 'none';
  layer.style.userSelect = 'none';
  // LEADER DOTS SIT ON THE BASELINE, like the periods they stand in for.
  //
  // The layer is therefore an ordinary line of text in the run's own face, with the LINE's
  // line-height — the same two things `paintLine` gives the text beside it, so the browser
  // resolves the identical baseline. Earlier attempts hung the glyphs off a zero-size strut
  // and tried to place that strut's baseline arithmetically; a strut with no metrics puts
  // its baseline at half the line-height (the vertical centre), and an inline-block aligns
  // by its OWN internal baseline rather than the one the arithmetic targeted, so the dots
  // came out first centred and then below the text. Matching the text's own setup is the
  // only version that needs no correction.
  // MIRROR `paintLine` EXACTLY, because the baseline is whatever that structure resolves
  // to and no arithmetic here can second-guess it: strut killed with `font-size: 0`, the
  // published line height as an explicit line-height, and the glyphs as a baseline-aligned
  // inline-block carrying their own BAND height — the run's own height plus the line's
  // extra leading, capped at the line box — over an inner line box one leading taller, so
  // a spaced line's leading is padded off the top of the dots exactly as it is off the text.
  // Leaving the band off let the glyphs inherit the whole line height, and their inner line
  // box then centred them; putting the face on the container instead gave the strut
  // different metrics from the dots and floated them.
  //
  // The mirror is literal, so it has to be MAINTAINED as one: both sides read `line.leading`,
  // neither recomputes it, and both spend it as padding rather than line-height. This
  // structure and `paintSpan`'s drifted apart once already, when only one of them was taught
  // that the leading sits above the text.
  layer.style.fontSize = '0';
  layer.style.lineHeight = `${line.box.height * scale}px`;

  const leading = line.leading ?? 0;
  const band = Math.min(span.box.height + leading, line.box.height);

  const glyphs = document.createElement('span');
  glyphs.style.display = 'inline-block';
  glyphs.style.verticalAlign = 'baseline';
  applyRunFaceStyle(glyphs, span.style, ctx);
  glyphs.style.boxSizing = 'border-box';
  glyphs.style.height = `${band * scale}px`;
  glyphs.style.paddingTop = `${leading * scale}px`;
  glyphs.style.lineHeight = `${(band - leading) * scale}px`;
  if (span.tabLeader === 'heavy') glyphs.style.fontWeight = 'bold';
  // ONE GLYPH PER ITS OWN ADVANCE — the leader is the same character typed over and over,
  // and Word spaces it exactly as typing it would. Layout measured that advance in this
  // run's face; guessing it (a fifth of the em, deliberately short so the repeat overfilled
  // and the clip decided where it ended) left the dots at whatever spacing an over-long
  // string happened to produce, reading as a fine dotted rule rather than periods. Falls
  // back to the old estimate only for a record laid out before the measurement existed.
  const advancePt =
    span.tabLeaderAdvancePt && span.tabLeaderAdvancePt > 0
      ? span.tabLeaderAdvancePt
      : Math.max(0.5, span.style.fontSizePt * 0.2);
  // Two glyphs of margin over the measured fit: the browser resolves its own face and its
  // advance may run a shade narrower than the measurer's, which would stop the leader short
  // of the stop. The layer clips, so the spare glyphs cost nothing.
  const count = Math.min(
    MAX_TAB_LEADER_GLYPHS,
    Math.max(1, Math.floor(span.box.width / advancePt) + 2)
  );
  glyphs.textContent = glyph.repeat(count); // SAFE: textContent, never innerHTML
  // No tracking on top of the glyph's own advance — the leader is plain repeated
  // punctuation, and inherited letter-spacing would re-space it.
  glyphs.style.letterSpacing = '0';
  layer.append(glyphs);
  return layer;
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
 * Paint one `w:pBdr` rule from layout geometry.
 *
 * Size, colour and position come from the record — never from computed style or
 * getBoundingClientRect. Colour is re-validated at the sink like every other file-derived
 * style value, and `side` is a closed union so it can safely reach a class name.
 */
function paintParagraphBorder(
  document: Document,
  fragment: ParagraphFragmentRecord,
  stroke: ParagraphBorderStrokeRecord,
  scale: number
): HTMLElement {
  const rule = positioned(document, 'div', stroke.box, scale);
  rule.className = `docx-paragraph-border docx-paragraph-border-${stroke.side}`;
  rule.setAttribute('aria-hidden', 'true');
  rule.style.left = `${(stroke.box.x - fragment.box.x) * scale}px`;
  rule.style.top = `${(stroke.box.y - fragment.box.y) * scale}px`;
  // Size already set by `positioned` from the published box; colour is the only extra.
  const color = stroke.edge.color && HEX.test(stroke.edge.color) ? stroke.edge.color : '000000';
  rule.style.backgroundColor = `#${color}`;
  // A side rule is a tall thin box, so its dash/double pattern runs down it rather than across.
  const vertical = stroke.side === 'left' || stroke.side === 'right' || stroke.side === 'bar';
  // `val` selects a CSS approximation; unknown styles fall back to a solid rule so a
  // recognised thickness is never silently dropped.
  switch (stroke.edge.val) {
    case 'dashed':
    case 'dashSmallGap': {
      const period = Math.max(4, 4 * scale);
      rule.style.backgroundImage = `linear-gradient(to ${vertical ? 'bottom' : 'right'}, #${color} 60%, transparent 60%)`;
      rule.style.backgroundSize = vertical ? `100% ${period}px` : `${period}px 100%`;
      break;
    }
    case 'dotted': {
      const period = Math.max(3, 3 * scale);
      rule.style.backgroundImage = `linear-gradient(to ${vertical ? 'bottom' : 'right'}, #${color} 35%, transparent 35%)`;
      rule.style.backgroundSize = vertical ? `100% ${period}px` : `${period}px 100%`;
      break;
    }
    case 'double': {
      // Two hairlines inside the published box thickness — still layout-owned geometry.
      const thickness = (vertical ? stroke.box.width : stroke.box.height) * scale;
      const half = Math.max(1, thickness / 3);
      rule.style.backgroundColor = 'transparent';
      if (vertical) {
        rule.style.borderLeft = `${half}px solid #${color}`;
        rule.style.borderRight = `${half}px solid #${color}`;
      } else {
        rule.style.borderTop = `${half}px solid #${color}`;
        rule.style.borderBottom = `${half}px solid #${color}`;
      }
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
  ctx: PaintContext
): HTMLElement {
  const scale = ctx.scale;
  const cellElement = positioned(document, 'div', cell.box, scale);
  cellElement.className = 'docx-table-cell';
  cellElement.style.left = `${(cell.box.x - rowBox.x) * scale}px`;
  cellElement.style.top = `${(cell.box.y - rowBox.y) * scale}px`;
  cellElement.style.boxSizing = 'border-box';
  cellElement.style.overflow = 'visible';
  // Cell identity in the DOM, so a gesture or a highlight can name the cell it is over
  // without re-deriving the grid from geometry.
  cellElement.dataset.cellId = cell.id;
  cellElement.dataset.gridColumn = String(cell.gridColumn);
  cellElement.dataset.gridSpan = String(cell.gridSpan);
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
        ? paintTableFragment(document, block, ctx)
        : paintFragment(document, block, ctx);
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
  ctx: PaintContext
): HTMLElement {
  const scale = ctx.scale;
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
      rowElement.append(paintTableCell(document, cell, row.box, ctx));
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
    container.style.overflow = 'hidden';
    // Furniture links paint styled but inert — see `paintHyperlinkAnchor`.
    const furnitureCtx: PaintContext & { readonly ariaHidden: boolean } = {
      ...options,
      inertLinks: true,
    };
    for (const fragment of story.fragments) {
      container.append(
        fragment.kind === 'table'
          ? paintTableFragment(document, fragment, furnitureCtx)
          : paintFragment(document, fragment, furnitureCtx)
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
    authorSlots: authorSlotsOf(layout),
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

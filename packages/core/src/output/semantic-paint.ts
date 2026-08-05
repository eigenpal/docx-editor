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

/* eslint-disable max-lines -- paint seam; note areas live in semantic-paint-notes.ts */

import { baselineShiftPtOf, TAB_LEADER_GLYPH } from '@docx-editor.dev/core/layout';
import { DEFAULT_CANVAS_FONT_STACK } from '../layout/canvas-measurer.ts';
import { authorSlotsOf, revisionPresentationOf } from './revision-presentation.ts';
import { formatRevisionOf, type RevisionAttribution } from '@docx-editor.dev/core/layout';
import type {
  ContentControlBoundaryRecord,
  ContentControlMappedType,
  LineRecord,
  PageRecord,
  ParagraphBorderStrokeRecord,
  ParagraphFragmentRecord,
  HeaderFooterStoryRecord,
  ResolvedRunStyle,
  SemanticLayout,
  SpanLinkRecord,
  StyleSpanRecord,
  TableCellFragmentRecord,
  TableFragmentRecord,
} from '@docx-editor.dev/core/layout';
import { paintPageNoteAreas } from './semantic-paint-notes.ts';
import { anchoredDrawingsOf } from '../layout/semantic-records.ts';
import type { AnchoredDrawingRecord } from '../layout/drawing-layout.ts';
import {
  collectUsedDrawingElementKeys,
  collectUsedDrawingResourceKeys,
  DEFAULT_DRAWING_PAINT_STRINGS,
  drawingPaintStringsCacheToken,
  drawingUrlRegistryFor,
  paintAnchoredDrawingsLayer,
  paintInlineDrawingsOnLine,
  type DrawingPaintContext,
  type DrawingPaintStrings,
  type PaintImageUrlPort,
} from './semantic-paint-drawings.ts';

/**
 * What the run painters need beyond the records: the pixel scale, and the optional
 * family-alias lookup that lets embedded fonts paint without their file-declared family
 * name entering the page-global CSS font namespace.
 */
export interface PaintContext {
  readonly scale: number;
  /** Generated paragraphs that paint as non-editable navigation surfaces. */
  readonly readOnlyParagraphIds?: ReadonlySet<string>;
  /**
   * Empty-TOC begin paragraphs that paint subtle identifiable furniture. Paint-only — never
   * serialised into the document.
   */
  readonly emptyTocPlaceholderIds?: ReadonlySet<string>;
  /**
   * Maps a document-declared family to the alias the host registered its bytes under, or
   * `undefined` when that family has no aliased face. Engine-minted values only.
   */
  readonly fontAlias?: (family: string) => string | undefined;
  /**
   * The family painted for a run whose cascade authors no font — the SAME face the
   * measurer falls back to. Without it such a run inherits the page's CSS font, and the
   * browser draws one face over geometry measured for another: wrap points, caret and
   * selection rectangles all drift from the visible glyphs.
   */
  readonly defaultFontFamily?: string;
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
  /** Localized drawing refusal labels (defaults to English fallbacks). */
  readonly drawingStrings?: DrawingPaintStrings;
  /** Host port for ready-image blob URLs; omitted means ready images paint as placeholders. */
  readonly imageUrlPort?: PaintImageUrlPort;
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
  /** Generated paragraphs that paint as non-editable navigation surfaces. */
  readonly readOnlyParagraphIds?: ReadonlySet<string>;
  /**
   * Empty-TOC begin paragraphs that paint subtle identifiable furniture. Paint-only — never
   * serialised into the document.
   */
  readonly emptyTocPlaceholderIds?: ReadonlySet<string>;
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
  /** See {@link PaintContext.defaultFontFamily}. */
  readonly defaultFontFamily?: string;
  /**
   * Relationship id of the header/footer story currently open for editing.
   *
   * When set, the matching `[data-docx-hf]` container is editable and every body
   * `.docx-page-content` box is inert; all other furniture stays read-only.
   */
  readonly activeHeaderFooterRId?: string;
  /**
   * Sheet that hosts the active visual occurrence of a shared furniture part.
   *
   * Required with {@link activeHeaderFooterRId} so only one painted copy receives
   * `data-docx-hf-active` / the engine caret when the same rId appears on many pages.
   */
  readonly activeHeaderFooterPageIndex?: number;
  /**
   * On-demand content-control boundary chrome (show-all and/or caret-entry).
   *
   * Furniture only — never contributes layout records or changes page geometry. Omitted or
   * empty means no control chrome is painted. Folded into the paint-reuse key so a toggle
   * rebuilds furniture without a layout pass.
   */
  readonly contentControlChrome?: {
    readonly showAll?: boolean;
    /** Control ids whose boundaries are visible because the caret is inside them. */
    readonly activeIds?: ReadonlySet<string>;
    /**
     * Control ids whose boundaries are visible because the pointer is over them.
     * Used for TOC hover chrome without projecting a persistent caret-active state.
     *
     * Deliberately OUTSIDE the paint-reuse key: hover must never rebuild a page. The
     * surface toggles `data-hover` / `data-boundary-visible` on the painted chrome it
     * already has, and this set only tells a page that rebuilds for some OTHER reason
     * which of its controls is currently under the pointer.
     */
    readonly hoverIds?: ReadonlySet<string>;
    /**
     * Control ids whose boundary furniture is painted by something else.
     *
     * An empty TOC paints its own placeholder box on the begin paragraph, so drawing the
     * control boundary as well left two rounded rectangles (of different heights) plus a
     * label chip stacked over one empty region.
     */
    readonly suppressedIds?: ReadonlySet<string>;
    /** Checkbox control ids whose canonical `w14:checked` state is on. */
    readonly checkedIds?: ReadonlySet<string>;
    /** Non-SDT structured regions that intentionally reuse content-control chrome. */
    readonly additionalBoundaries?: readonly ContentControlBoundaryRecord[];
    /** Control ids that represent TOC regions (hover-only chrome; never caret-sticky). */
    readonly tocControlIds?: ReadonlySet<string>;
  };
  readonly drawingStrings?: DrawingPaintStrings;
  readonly imageUrlPort?: PaintImageUrlPort;
}

export type { DrawingPaintStrings, PaintImageUrlPort } from './semantic-paint-drawings.ts';

type DrawingUrlRegistry = ReturnType<typeof drawingUrlRegistryFor>;

type DrawingPaintHostContext = PaintContext & {
  readonly drawingStrings?: DrawingPaintStrings;
  readonly urlRegistry?: DrawingUrlRegistry | null;
  /** Per-page discriminator for drawing element reuse (see DrawingPaintContext). */
  readonly paintInstance?: string;
};

interface ResolvedPaintContext extends DrawingPaintHostContext {
  readonly drawingStrings: DrawingPaintStrings;
  readonly urlRegistry: DrawingUrlRegistry | null;
}

function asResolvedPaintContext(ctx: DrawingPaintHostContext): ResolvedPaintContext {
  return {
    ...ctx,
    drawingStrings: ctx.drawingStrings ?? DEFAULT_DRAWING_PAINT_STRINGS,
    urlRegistry: ctx.urlRegistry ?? null,
  };
}

function resolvedDrawingPaint(ctx: ResolvedPaintContext): DrawingPaintContext {
  return Object.freeze({
    scale: ctx.scale,
    strings: ctx.drawingStrings,
    ...(ctx.imageUrlPort ? { imageUrlPort: ctx.imageUrlPort } : {}),
    ...(ctx.inertLinks ? { inertLinks: true } : {}),
    ...(ctx.paintInstance ? { paintInstance: ctx.paintInstance } : {}),
  });
}

function drawingContextOf(ctx: ResolvedPaintContext): {
  readonly ctx: DrawingPaintContext;
  readonly urlRegistry: DrawingUrlRegistry | null;
} {
  return Object.freeze({
    ctx: resolvedDrawingPaint(ctx),
    urlRegistry: ctx.urlRegistry,
  });
}

function appendAnchoredDrawingLayer(
  document: Document,
  parent: HTMLElement,
  page: PageRecord,
  ctx: ResolvedPaintContext,
  pageOrigin: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  },
  layer: 'behind' | 'inFront'
): void {
  appendAnchoredDrawingsForRecords(
    document,
    parent,
    anchoredDrawingsOf(page),
    ctx,
    pageOrigin,
    layer
  );
}

function appendAnchoredDrawingsForRecords(
  document: Document,
  parent: HTMLElement,
  drawings: readonly AnchoredDrawingRecord[],
  ctx: ResolvedPaintContext,
  origin: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  },
  layer: 'behind' | 'inFront'
): void {
  if (drawings.length === 0) return;
  const drawing = drawingContextOf(ctx);

  const layerElement = document.createElement('div');
  layerElement.className =
    layer === 'behind'
      ? 'docx-drawing-layer docx-drawing-layer-behind'
      : 'docx-drawing-layer docx-drawing-layer-front';
  layerElement.style.position = 'absolute';
  layerElement.style.inset = '0';
  layerElement.style.pointerEvents = 'none';
  for (const element of paintAnchoredDrawingsLayer(
    document,
    drawings,
    layer,
    drawing.ctx,
    drawing.urlRegistry,
    origin
  )) {
    element.style.pointerEvents = 'auto';
    layerElement.append(element);
  }
  if (layerElement.childElementCount > 0) parent.append(layerElement);
}

function isPageRelativeHfAnchor(drawing: AnchoredDrawingRecord): boolean {
  return drawing.horizontalFrame === 'page' || drawing.verticalFrame === 'page';
}

function hfAnchorOnPageSheet(
  story: HeaderFooterStoryRecord,
  drawing: AnchoredDrawingRecord
): AnchoredDrawingRecord {
  const pb = drawing.paintBounds;
  return Object.freeze({
    ...drawing,
    paintBounds: Object.freeze({
      x: story.box.x + pb.x,
      y: story.box.y + pb.y,
      width: pb.width,
      height: pb.height,
    }),
  });
}

function appendHfPageRelativeDrawingLayer(
  document: Document,
  pageElement: HTMLElement,
  story: HeaderFooterStoryRecord,
  drawings: readonly AnchoredDrawingRecord[],
  ctx: ResolvedPaintContext,
  pageOrigin: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  },
  layer: 'behind' | 'inFront'
): void {
  const pageRelative = drawings
    .filter(isPageRelativeHfAnchor)
    .map((drawing) => hfAnchorOnPageSheet(story, drawing));
  appendAnchoredDrawingsForRecords(document, pageElement, pageRelative, ctx, pageOrigin, layer);
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
  // sink that trusts its caller is one refactor away from being the hole. A run with no
  // resolved family paints in the surface's default face — the face it was MEASURED in —
  // never in whatever font the page happens to inherit.
  const family =
    style.fontFamily && FONT_NAME.test(style.fontFamily)
      ? style.fontFamily
      : ctx.defaultFontFamily && FONT_NAME.test(ctx.defaultFontFamily)
        ? ctx.defaultFontFamily
        : null;
  if (family) {
    // An alias names bytes the host registered for THIS document under a family a file
    // cannot collide with. It leads, with the declared family behind it: document text
    // gets the embedded glyphs while the page-global CSS font namespace keeps its own
    // meaning for the declared name. `FONT_NAME` gates the declared family; the alias is
    // engine-minted, never file-derived.
    const alias = ctx.fontAlias?.(family);
    // The measurer's fallback stack trails the family so an unresolvable name falls
    // back to the SAME face measurement fell back to — not to the inherited font.
    css.fontFamily = alias
      ? `"${alias}", "${family}", ${DEFAULT_CANVAS_FONT_STACK}`
      : `"${family}", ${DEFAULT_CANVAS_FONT_STACK}`;
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
  // A tracked FORMAT change alters no characters, so it has no strike or underline of its own
  // to wear. It still has to be visible: the reader is looking at text whose appearance is
  // itself a pending decision. A dashed rule and a tint say "this changed" without claiming
  // the words were added or removed.
  const format = formatRevisionOf(span.props);
  const presentation = revisionPresentationOf(span.revisions, ctx.authorSlots);
  if (!presentation && !format) return;

  if (presentation) {
    const { attribution } = presentation;
    element.classList.add('docx-revision', `docx-revision-${attribution.kind}`);
    element.dataset.revisionKind = attribution.kind;
    element.dataset.revisionId = attribution.id;
    element.dataset.revisionAuthor = attribution.author;
    if (attribution.date !== undefined) element.dataset.revisionDate = attribution.date;
    element.style.color = presentation.color;
    // The TINT is what makes a change findable when scanning rather than reading. A decoration
    // alone is a hairline: on a dense page of small type it disappears, and a reviewer skims
    // straight past an edit.
    //
    // The WASH, not the full tint. This layer covers every tracked change in the document; the
    // band layer covers only the open one and adds the full tint over this. Painting both at
    // full strength gave pending and open changes the same weight — the pale/open distinction
    // the band exists to draw never appeared, because this was already at the band's colour.
    element.style.backgroundColor = presentation.deleted
      ? 'var(--doc-revision-deletion-wash)'
      : 'var(--doc-revision-insertion-wash)';
    if (presentation.line) {
      element.style.textDecorationLine = presentation.line;
      element.style.textDecorationStyle = presentation.decorationStyle;
      element.style.textDecorationColor = presentation.color;
    }
    return;
  }

  // A tracked FORMAT change gets its provenance and NO inline decoration — its marking
  // (a grey wash and a faint dotted rule) comes from the STYLESHEET's
  // `.docx-revision-format`, not from style written here. The split is deliberate: an
  // authored underline or strike is painted as inline style and so outranks the stylesheet,
  // keeping the author's own decoration intact, and a host that finds even the quiet grey
  // too loud at its documents' density (a real fixture carries 18,284 of these) can silence
  // it with one CSS override instead of forking the painter.
  element.classList.add('docx-revision', 'docx-revision-format');
  element.dataset.revisionKind = 'format';
  element.dataset.revisionId = format!.id;
  element.dataset.revisionAuthor = format!.author;
  if (format!.date !== undefined) element.dataset.revisionDate = format!.date;
}

/**
 * The pilcrow beside a paragraph whose MARK was inserted or deleted.
 *
 * Word draws it because there is nothing else to draw: the change is to the paragraph break
 * itself, so no character carries it. A struck-through ¶ is how a reader sees that this
 * paragraph is being merged into the next one, and an underlined one that it was split here.
 *
 * Furniture: no model range, `aria-hidden`, not editable, so it can never be selected, copied
 * or counted as text.
 */
function paintParagraphMark(
  document: Document,
  revision: RevisionAttribution,
  scale: number
): HTMLElement {
  const glyph = document.createElement('span');
  glyph.className = `docx-revision-pmark docx-revision-pmark-${revision.kind}`;
  glyph.setAttribute('aria-hidden', 'true');
  glyph.contentEditable = 'false';
  glyph.dataset.revisionKind = revision.kind;
  glyph.dataset.revisionId = revision.id;
  glyph.dataset.revisionAuthor = revision.author;
  glyph.textContent = '\u00b6';
  glyph.style.position = 'absolute';
  glyph.style.pointerEvents = 'none';
  glyph.style.marginLeft = `${2 * scale}px`;
  glyph.style.color =
    revision.kind === 'delete' ? 'var(--doc-revision-deletion)' : 'var(--doc-revision-insertion)';
  if (revision.kind === 'delete') glyph.style.textDecorationLine = 'line-through';
  return glyph;
}

/**
 * The margin rules beside the lines that carry tracked changes.
 *
 * CONTIGUOUS lines MERGE into one rule. Drawn per line, a five-line edit reads as five separate
 * marks with hairline gaps between them at every line boundary — the eye sees a dashed rule
 * where Word draws a solid one, and the gaps imply the change stops and restarts.
 *
 * Coloured by kind, so the margin says what happened as well as that something did. A run of
 * lines carrying both an insertion and a deletion takes the deletion colour: removed text is
 * the stronger claim, and it is the one a reviewer scanning the margin must not miss.
 *
 * Furniture throughout: one overlay, `aria-hidden`, `pointer-events: none`, no model range, and
 * positioned in the margin the fragment box already leaves, so it can never move a glyph.
 */
function paintChangeBars(
  document: Document,
  fragment: ParagraphFragmentRecord,
  scale: number
): HTMLElement | null {
  interface BarRun {
    top: number;
    bottom: number;
    deleted: boolean;
  }
  const runs: BarRun[] = [];
  for (const line of fragment.lines) {
    const revisions = line.spans.flatMap((span) => span.revisions ?? []);
    if (revisions.length === 0) continue;
    const deleted = revisions.some(
      (revision) => revision.kind === 'delete' || revision.kind === 'moveFrom'
    );
    const top = line.box.y - fragment.box.y;
    const bottom = top + line.box.height;
    const previous = runs[runs.length - 1];
    // Touching or overlapping lines of the same claim are one rule.
    if (previous && previous.deleted === deleted && top <= previous.bottom + 0.5) {
      previous.bottom = Math.max(previous.bottom, bottom);
      continue;
    }
    runs.push({ top, bottom, deleted });
  }
  if (runs.length === 0) return null;

  const overlay = document.createElement('div');
  overlay.className = 'docx-change-bars';
  overlay.setAttribute('aria-hidden', 'true');
  overlay.style.position = 'absolute';
  overlay.style.inset = '0';
  overlay.style.pointerEvents = 'none';
  for (const run of runs) {
    const bar = document.createElement('div');
    bar.className = `docx-change-bar docx-change-bar-${run.deleted ? 'deletion' : 'insertion'}`;
    bar.style.position = 'absolute';
    bar.style.top = `${run.top * scale}px`;
    bar.style.height = `${(run.bottom - run.top) * scale}px`;
    // ANCHORED TO THE MARGIN, NOT TO THE PARAGRAPH. The bar is a child of the fragment, whose
    // left edge is the paragraph's indented column — so an offset from the fragment put the
    // rule at a different x for every indent level, and a nested list drew a staircase down
    // the page. Subtracting the fragment's own x lands every bar on one vertical line, which
    // is what makes a column of them readable as "these lines changed".
    bar.style.left = `${(-fragment.box.x - CHANGE_BAR_OFFSET_PT) * scale}px`;
    bar.style.width = `${CHANGE_BAR_WIDTH_PT * scale}px`;
    bar.style.pointerEvents = 'none';
    bar.style.backgroundColor = run.deleted
      ? 'var(--doc-revision-deletion)'
      : 'var(--doc-revision-insertion)';
    overlay.append(bar);
  }
  return overlay;
}

/**
 * Distance from the text column to the change bar, and its thickness, in points.
 *
 * Close enough to read as belonging to the line, far enough not to collide with a hanging
 * indent or a list marker.
 */
const CHANGE_BAR_OFFSET_PT = 7.5;
const CHANGE_BAR_WIDTH_PT = 1.5;

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
  // THE BAND IS THE BOX; `extraLeadingPt` IS SPACE ABOVE THE GLYPHS INSIDE IT.
  //
  // Auto/atLeast extras live BELOW the glyph band (line padding-bottom in `paintLine`).
  // Exact centering (and any other above-band) is padding-top here. Sizing the run by
  // `line-height` alone leaves CSS to split leading in half and drift off `line.baseline`.
  //
  // Growing the line-height instead of padding is wrong for selection too: the browser
  // paints the native selection to the INNER LINE BOX, so a box shorter than its own
  // line-height bled highlight into the line below.
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
  if (span.projected) {
    element.dataset.docxField = '';
    element.setAttribute('contenteditable', 'false');
    // Note citations stay pointer-interactive for navigation; PAGE fields stay inert.
    if (span.noteNav) {
      element.style.userSelect = 'none';
      if (span.noteNav.direction === 'to-note') {
        element.dataset.docxNoteRef = '';
        element.dataset.docxNoteScope = span.noteNav.scopeId;
        if (span.text.length > 0) {
          element.setAttribute('aria-description', span.text);
        }
      } else {
        element.dataset.docxNoteMarkBack = '';
        element.dataset.docxNoteScope = span.noteNav.scopeId;
      }
    } else {
      element.style.pointerEvents = 'none';
      element.style.userSelect = 'none';
    }
  }
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
function paintLine(
  document: Document,
  line: LineRecord,
  ctx: DrawingPaintHostContext
): HTMLElement {
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
  element.style.whiteSpace = 'pre';
  // A raised superscript or a tall glyph draws outside the line box rather than being
  // clipped at it; the box governs spacing and the selection band, not what is visible.
  element.style.overflow = 'visible';

  // Justified lines carry their slack in the gaps BETWEEN spans. Inline flow has no gaps,
  // so the same slack is reapplied as word spacing rather than being silently dropped.
  const gap = interSpanGap(line);
  if (gap > 0) element.style.wordSpacing = `${gap * scale}px`;

  // Per-run band heights, chosen so the browser's line-box math cannot move a glyph:
  // the tallest run's band is the glyph band (own height + space-above leading), and any
  // remaining line-box depth is padding-bottom — Word's auto/atLeast extras sit BELOW the
  // text. Capped at the line height so an `exact`-spaced line cannot grow past its box.
  //
  // The leading is READ, not recovered from the box. The marker and the tab leader place
  // their furniture against this same number, and when each of the three derived it for
  // itself they drifted: the text moved onto the published baseline while the marker
  // beside it stayed half a leading higher.
  const leading = line.leading ?? 0;
  const glyphBand = Math.min(
    Math.max(
      leading,
      ...line.spans.map((span) => span.box.height + leading),
      // Empty lines still need a content band so the caret has a strut — the paragraph
      // mark's own depth, which layout publishes, not the whole spaced box.
      line.spans.length === 0 ? (line.glyphBand ?? line.box.height) : 0
    ),
    line.box.height
  );
  const trailing = Math.max(0, line.box.height - glyphBand);
  element.style.boxSizing = 'border-box';
  element.style.paddingBottom = `${trailing * scale}px`;
  element.style.lineHeight = `${(line.box.height - trailing) * scale}px`;
  // Consecutive spans of the SAME link share one anchor, so a link that spans several
  // formatting runs on one line is one `<a>` — one focus stop, one hover target, one thing
  // a screen reader announces. A link that WRAPS gets one anchor per line, which is the
  // only shape an absolutely-positioned line model can express.
  let anchor: HTMLElement | null = null;
  let anchorLinkId: string | null = null;
  const inlineDrawings = [...(line.drawings ?? [])].sort((left, right) => left.start - right.start);
  let nextInlineDrawing = 0;
  const appendDrawingAdvancesBefore = (modelOffset: number): void => {
    while (
      nextInlineDrawing < inlineDrawings.length &&
      inlineDrawings[nextInlineDrawing]!.start < modelOffset
    ) {
      const drawing = inlineDrawings[nextInlineDrawing]!;
      const advance = Math.max(0, drawing.advanceEnd - drawing.advanceStart);
      const spacer = document.createElement('span');
      spacer.className = 'docx-inline-drawing-advance';
      spacer.dataset.docxMarker = '';
      spacer.setAttribute('contenteditable', 'false');
      spacer.setAttribute('aria-hidden', 'true');
      spacer.style.display = 'inline-block';
      spacer.style.width = `${advance * scale}px`;
      // The image itself is absolutely painted, so this inert inline box must also publish
      // its vertical advance. Otherwise CSS aligns text against a zero-height spacer while
      // layout aligns the engine caret against the drawing baseline.
      spacer.style.height = `${drawing.baselineOffset * scale}px`;
      spacer.style.lineHeight = '0';
      spacer.style.pointerEvents = 'none';
      spacer.style.verticalAlign = 'baseline';
      element.append(spacer);
      nextInlineDrawing += 1;
      anchor = null;
      anchorLinkId = null;
    }
  };
  /**
   * Reserve the horizontal jump a float's wrap zone forced, so the line resumes in the next
   * passage instead of flowing straight across the picture.
   */
  const appendWrapAdvance = (span: StyleSpanRecord): void => {
    const advance = span.wrapAdvanceBefore ?? 0;
    if (advance <= 0.001) return;
    const spacer = document.createElement('span');
    spacer.className = 'docx-wrap-advance';
    spacer.dataset.docxMarker = '';
    spacer.setAttribute('contenteditable', 'false');
    spacer.setAttribute('aria-hidden', 'true');
    spacer.style.display = 'inline-block';
    spacer.style.width = `${advance * scale}px`;
    spacer.style.height = '0';
    spacer.style.lineHeight = '0';
    spacer.style.pointerEvents = 'none';
    spacer.style.verticalAlign = 'baseline';
    element.append(spacer);
    // The gap is not part of any link's text, so an anchor cannot span it.
    anchor = null;
    anchorLinkId = null;
  };

  for (const span of line.spans) {
    appendDrawingAdvancesBefore(span.range.start);
    appendWrapAdvance(span);
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
  appendDrawingAdvancesBefore(Number.POSITIVE_INFINITY);
  // A span-less line (empty paragraph) has no inline content, and a browser will not
  // draw a caret at a position with no inline box to measure. The <br> is the anchor;
  // sizing it to the line keeps the caret the paragraph's font height, not the div's
  // default.
  if (line.spans.length === 0) {
    const anchor = document.createElement('br');
    anchor.style.lineHeight = `${line.box.height * scale}px`;
    element.append(anchor);
  }

  const lineOrigin = Object.freeze({
    x: line.spans[0]?.box.x ?? line.box.x,
    y: line.box.y,
    width: line.box.width,
    height: line.box.height,
  });
  const drawingCtx = drawingContextOf(asResolvedPaintContext(ctx));
  if (line.drawings && line.drawings.length > 0) {
    for (const painted of paintInlineDrawingsOnLine(
      document,
      line,
      drawingCtx.ctx,
      drawingCtx.urlRegistry,
      lineOrigin
    )) {
      element.append(painted);
    }
  }
  return element;
}

/** The extra space layout put between word spans, beyond their own advances. */
function interSpanGap(line: LineRecord): number {
  if (line.spans.length < 2) return 0;
  // Layout justifies only after expandable spaces, so many consecutive pairs (tab→word,
  // run split without a space) have a zero gap. Averaging those zeros in diluted
  // `word-spacing` below the real per-space step and every later glyph drifted left of
  // its published box — caret mid-word included.
  const gaps: number[] = [];
  for (let index = 1; index < line.spans.length; index += 1) {
    const previous = line.spans[index - 1]!;
    const current = line.spans[index]!;
    const drawingOccupiesGap = line.drawings?.some(
      (drawing) => drawing.start >= previous.range.end && drawing.start < current.range.start
    );
    if (drawingOccupiesGap) continue;
    // A float's wrap zone is an obstacle the line stepped over, not slack to redistribute.
    // Averaging it in turned the picture's whole width into word spacing on every space.
    const gap =
      current.box.x - (previous.box.x + previous.box.width) - (current.wrapAdvanceBefore ?? 0);
    if (gap > 0.25) gaps.push(gap);
  }
  if (gaps.length === 0) return 0;
  return gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;
}

function paintFragment(
  document: Document,
  fragment: ParagraphFragmentRecord,
  ctx: DrawingPaintHostContext
): HTMLElement {
  const scale = ctx.scale;
  const element = positioned(document, 'div', fragment.box, scale);
  element.className = 'docx-paragraph-fragment layout-paragraph';
  element.dataset.paragraphId = fragment.paragraphId;
  element.dataset.fragmentIndex = String(fragment.fragmentIndex);
  if (ctx.readOnlyParagraphIds?.has(fragment.paragraphId)) {
    element.classList.add('docx-generated-region');
    element.dataset.docxReadOnly = '';
    element.setAttribute('contenteditable', 'false');
    element.setAttribute('aria-readonly', 'true');
  }
  if (ctx.emptyTocPlaceholderIds?.has(fragment.paragraphId)) {
    element.classList.add('docx-toc-empty-placeholder');
    element.dataset.docxTocEmpty = '';
  }
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
  // CHANGE BARS. Word draws a rule in the margin beside every line a revision touches, and it
  // is the only signal that a change exists at all once the reader is in a resolved view.
  const bars = paintChangeBars(document, fragment, scale);
  if (bars) element.append(bars);
  if (fragment.markRevision) {
    const glyph = paintParagraphMark(document, fragment.markRevision, scale);
    const last = fragment.lines[fragment.lines.length - 1];
    if (last) {
      // At the end of the last line's text, which is where the mark itself sits.
      const end = last.spans[last.spans.length - 1];
      glyph.style.top = `${(last.box.y - fragment.box.y) * scale}px`;
      glyph.style.left = `${((end ? end.box.x + end.box.width : last.box.x) - fragment.box.x) * scale}px`;
      element.append(glyph);
    }
  }
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
  // Mirror `paintLine`: content band at the top (plus any above-leading), auto extras as
  // padding-bottom so the marker shares the text baseline on spaced lines.
  const firstLine = fragment.lines[0];
  const maxSpanH = firstLine
    ? Math.max(0, ...firstLine.spans.map((span) => span.box.height))
    : marker.box.height;
  const glyphBand = Math.min(Math.max(leading + maxSpanH, leading), marker.box.height);
  const trailing = Math.max(0, marker.box.height - glyphBand);
  element.style.fontSize = '0';
  element.style.boxSizing = 'border-box';
  element.style.paddingBottom = `${trailing * scale}px`;
  element.style.lineHeight = `${glyphBand * scale}px`;
  const glyph = document.createElement('span');
  glyph.style.display = 'inline-block';
  glyph.style.verticalAlign = 'baseline';
  glyph.style.boxSizing = 'border-box';
  glyph.style.height = `${glyphBand * scale}px`;
  glyph.style.paddingTop = `${leading * scale}px`;
  glyph.style.lineHeight = `${(glyphBand - leading) * scale}px`;
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
  const leading = line.leading ?? 0;
  const band = Math.min(span.box.height + leading, line.box.height);
  const trailing = Math.max(0, line.box.height - band);
  layer.style.fontSize = '0';
  layer.style.boxSizing = 'border-box';
  layer.style.paddingBottom = `${trailing * scale}px`;
  layer.style.lineHeight = `${(line.box.height - trailing) * scale}px`;

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
 *
 * `ST_Border` mapping (ECMA-376): common line styles get a CSS approximation; decorative
 * art borders fall through to a solid rule. Compound styles (`double`, …) rely on layout
 * having published the inflated band — paint must not re-derive mins.
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
  const publishedLeft = (stroke.box.x - fragment.box.x) * scale;
  const publishedTop = (stroke.box.y - fragment.box.y) * scale;
  // Preserve layout geometry, but snap a very thin SINGLE rule to a visible screen hairline.
  // Word's 1/4pt header rules otherwise become 0.33 CSS px at 96dpi and effectively disappear.
  // Compound styles already inflate in layout, so they keep the published thickness.
  const vertical = stroke.side === 'left' || stroke.side === 'right' || stroke.side === 'bar';
  const publishedThickness = (vertical ? stroke.box.width : stroke.box.height) * scale;
  const compound = isCompoundParagraphBorder(stroke.edge.val);
  const paintedThickness = compound ? publishedThickness : Math.max(1, publishedThickness);
  rule.style.left = `${
    stroke.side === 'right'
      ? publishedLeft - (paintedThickness - publishedThickness)
      : publishedLeft
  }px`;
  rule.style.top = `${
    stroke.side === 'bottom' ? publishedTop - (paintedThickness - publishedThickness) : publishedTop
  }px`;
  if (vertical) {
    rule.style.width = `${paintedThickness}px`;
  } else {
    rule.style.height = `${paintedThickness}px`;
  }
  const color = stroke.edge.color && HEX.test(stroke.edge.color) ? stroke.edge.color : '000000';
  rule.style.backgroundColor = `#${color}`;
  // A side rule is a tall thin box, so its dash/double pattern runs down it rather than across.
  // `val` selects a CSS approximation; unknown / art styles fall back to a solid rule so a
  // recognised thickness is never silently dropped.
  applyParagraphBorderStyle(rule, stroke.edge.val, color, vertical, paintedThickness, scale);
  return rule;
}

/** Compound `ST_Border` values that layout already inflated — do not hairline-snap. */
function isCompoundParagraphBorder(val: string): boolean {
  return (
    val === 'double' ||
    val === 'triple' ||
    val === 'doubleWave' ||
    val.startsWith('thinThick') ||
    val.startsWith('thickThin')
  );
}

/**
 * Map authored `ST_Border` onto the painted rule.
 *
 * CSS gives `double` / `dashed` / `dotted` / `groove` / `ridge` / `inset` / `outset` almost
 * for free. Decorative art borders (apples, bats, …) stay solid — a deliberate approximation.
 */
function applyParagraphBorderStyle(
  rule: HTMLElement,
  val: string,
  color: string,
  vertical: boolean,
  thicknessPx: number,
  scale: number
): void {
  switch (val) {
    case 'dashed':
    case 'dashSmallGap':
    case 'dotDash':
    case 'dotDotDash':
    case 'dashDotStroked': {
      const period = Math.max(4, 4 * scale);
      rule.style.backgroundImage = `linear-gradient(to ${vertical ? 'bottom' : 'right'}, #${color} 60%, transparent 60%)`;
      rule.style.backgroundSize = vertical ? `100% ${period}px` : `${period}px 100%`;
      return;
    }
    case 'dotted': {
      const period = Math.max(3, 3 * scale);
      rule.style.backgroundImage = `linear-gradient(to ${vertical ? 'bottom' : 'right'}, #${color} 35%, transparent 35%)`;
      rule.style.backgroundSize = vertical ? `100% ${period}px` : `${period}px 100%`;
      return;
    }
    case 'double':
    case 'doubleWave':
    case 'triple':
    case 'thinThickSmallGap':
    case 'thickThinSmallGap':
    case 'thinThickThinSmallGap':
    case 'thinThickMediumGap':
    case 'thickThinMediumGap':
    case 'thinThickThinMediumGap':
    case 'thinThickLargeGap':
    case 'thickThinLargeGap':
    case 'thinThickThinLargeGap': {
      // Two hairlines inside the published box — layout owns the band (incl. thin-double floor).
      // Triple and thinThick* compound vals approximate as double; decorative art stays solid.
      const line = Math.max(1, thicknessPx / 3);
      rule.style.backgroundColor = 'transparent';
      if (vertical) {
        rule.style.borderLeft = `${line}px solid #${color}`;
        rule.style.borderRight = `${line}px solid #${color}`;
      } else {
        rule.style.borderTop = `${line}px solid #${color}`;
        rule.style.borderBottom = `${line}px solid #${color}`;
      }
      rule.style.boxSizing = 'border-box';
      return;
    }
    case 'threeDEmboss':
    case 'ridge': {
      rule.style.backgroundColor = 'transparent';
      const side = vertical ? 'borderLeft' : 'borderTop';
      rule.style[side] = `${Math.max(1, thicknessPx)}px ridge #${color}`;
      if (vertical) rule.style.width = '0px';
      else rule.style.height = '0px';
      return;
    }
    case 'threeDEngrave':
    case 'groove': {
      rule.style.backgroundColor = 'transparent';
      const side = vertical ? 'borderLeft' : 'borderTop';
      rule.style[side] = `${Math.max(1, thicknessPx)}px groove #${color}`;
      if (vertical) rule.style.width = '0px';
      else rule.style.height = '0px';
      return;
    }
    case 'inset': {
      rule.style.backgroundColor = 'transparent';
      const side = vertical ? 'borderLeft' : 'borderTop';
      rule.style[side] = `${Math.max(1, thicknessPx)}px inset #${color}`;
      if (vertical) rule.style.width = '0px';
      else rule.style.height = '0px';
      return;
    }
    case 'outset': {
      rule.style.backgroundColor = 'transparent';
      const side = vertical ? 'borderLeft' : 'borderTop';
      rule.style[side] = `${Math.max(1, thicknessPx)}px outset #${color}`;
      if (vertical) rule.style.width = '0px';
      else rule.style.height = '0px';
      return;
    }
    case 'single':
    case 'thick':
    case 'wave':
    default:
      // Solid fill already set. Art borders and unrecognised vals stay solid.
      return;
  }
}

import { applyCellBorders } from './semantic-paint-table-borders.ts';

function paintTableCell(
  document: Document,
  cell: TableCellFragmentRecord,
  rowBox: { readonly x: number; readonly y: number },
  ctx: DrawingPaintHostContext
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
  ctx: DrawingPaintHostContext
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
    if (row.revisionKind) {
      rowElement.classList.add(
        'docx-table-row--revision',
        row.revisionKind === 'insert' ? 'layout-revision-ins' : 'layout-revision-del'
      );
      // The same attribution datasets revision SPANS carry, so chrome that maps a hovered
      // element to its review decision treats a tracked row like any other tracked change.
      // Dataset assignment escapes; the values are attacker-controlled and never markup.
      rowElement.dataset.revisionKind = row.revisionKind;
      if (row.revisionId !== undefined) rowElement.dataset.revisionId = row.revisionId;
      if (row.revisionAuthor !== undefined) rowElement.dataset.revisionAuthor = row.revisionAuthor;
      if (row.revisionDate !== undefined) rowElement.dataset.revisionDate = row.revisionDate;
    }
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
  baseOptions: ResolvedPaintContext & {
    readonly ariaHidden: boolean;
    readonly activeHeaderFooterRId?: string;
    readonly activeHeaderFooterPageIndex?: number;
    readonly contentControlChrome?: PaintOptions['contentControlChrome'];
  },
  materialize: boolean
): HTMLElement {
  // Every drawing painted below carries this page's instance key, so a repaint of the
  // page reuses its own already-decoded <img> elements (no per-keystroke flash) without
  // ever stealing a repeated header image from a sibling page.
  const options = { ...baseOptions, paintInstance: `p${page.index}` };
  const element = positioned(document, 'div', page.box, options.scale);
  // Deliberately NOT `layout-page`: that class carries the legacy lane's whole-frame
  // inversion, which would flip the paper itself. The sheet keeps the canvas colour its
  // token names and only `.docx-page-content` below is inverted, so the theme and print
  // rules name that class instead.
  element.className = 'docx-page';
  // The measurer's own fallback stack, so an unstyled run — or one whose declared family
  // the platform cannot resolve — RENDERS in the same face it was MEASURED in. Left to
  // inherit, the page picked up the host UI font, and every measured overlay (caret,
  // selection, revision bands, strikes) drifted along the line against the painted glyphs.
  element.style.fontFamily = DEFAULT_CANVAS_FONT_STACK;
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

  const pageOrigin = Object.freeze({
    x: page.box.x,
    y: page.box.y,
    width: page.box.width,
    height: page.box.height,
  });
  // Body anchored records are per-page CONTENT-relative (a page-frame drawing at offset 0
  // publishes paintBounds x/y = -margin). The layer lives on the page element, so the
  // origin is the negated content inset — never page.box, which is absolute and would
  // both drop the margins and displace every page after the first.
  const bodyAnchorOrigin = Object.freeze({
    x: -(page.contentBox.x - page.box.x),
    y: -(page.contentBox.y - page.box.y),
    width: page.box.width,
    height: page.box.height,
  });
  appendAnchoredDrawingLayer(document, element, page, options, bodyAnchorOrigin, 'behind');

  const content = document.createElement('div');
  content.className = 'docx-page-content';
  content.style.position = 'absolute';
  content.style.left = `${(page.contentBox.x - page.box.x) * options.scale}px`;
  content.style.top = `${(page.contentBox.y - page.box.y) * options.scale}px`;
  content.style.width = `${page.contentBox.width * options.scale}px`;
  content.style.height = `${page.contentBox.height * options.scale}px`;
  if (options.activeHeaderFooterRId) {
    content.setAttribute('contenteditable', 'false');
  }
  for (const separator of page.columnSeparators ?? []) {
    const rule = document.createElement('div');
    rule.className = 'docx-column-separator';
    rule.setAttribute('contenteditable', 'false');
    rule.style.position = 'absolute';
    rule.style.left = `${separator.x * options.scale}px`;
    rule.style.top = `${separator.y * options.scale}px`;
    rule.style.width = `${separator.width * options.scale}px`;
    rule.style.height = `${separator.height * options.scale}px`;
    rule.style.backgroundColor = 'currentColor';
    rule.style.pointerEvents = 'none';
    content.append(rule);
  }
  for (const fragment of page.fragments) {
    content.append(
      fragment.kind === 'table'
        ? paintTableFragment(document, fragment, options)
        : paintFragment(document, fragment, options)
    );
  }
  element.append(content);

  appendAnchoredDrawingLayer(document, element, page, options, bodyAnchorOrigin, 'inFront');

  // Footnotes / endnotes — editable stories inside the sheet (not [data-docx-hf] furniture).
  paintPageNoteAreas(document, element, page, options, paintFragment, paintTableFragment);

  // Page furniture (phase 2, read-only): painted inside the sheet but OUTSIDE the content
  // box, inert to editing. `data-docx-hf` is what dom-selection uses to refuse mapping a
  // browser caret inside the furniture back to a model position.
  // Blank furniture affordance: a page with no header (or footer) paints an EMPTY band over
  // that margin — `data-docx-hf` with no relationship id — so hover can invite and a double
  // click can create the story. Geometry mirrors the pointer's activation band: the full
  // margin strip at content width. Never printed (CSS hides it), never editable.
  for (const kind of ['header', 'footer'] as const) {
    if (page[kind]) continue;
    const band = document.createElement('div');
    band.className = 'docx-hf docx-hf--placeholder';
    band.dataset.docxHf = kind;
    band.setAttribute('contenteditable', 'false');
    // A SLIM strip where a real header/footer would FLOW — the default furniture distance
    // from the sheet edge — not the whole margin and not the content edge: anchored to
    // content, a cover page with a deep top area drew the invitation halfway down the
    // page, glued to its own heading. Word's header area is a couple of lines near the
    // edge; the pointer still accepts the full margin band, so the visual stays modest
    // without shrinking the target.
    const marginHeight =
      kind === 'header'
        ? page.contentBox.y - page.box.y
        : page.box.y + page.box.height - (page.contentBox.y + page.contentBox.height);
    const height = Math.min(marginHeight, PLACEHOLDER_BAND_PT);
    if (height <= 0) continue;
    // Squeezed toward the content edge when the margin is too tight for distance + band.
    const edgeOffset = Math.max(0, Math.min(PLACEHOLDER_DISTANCE_PT, marginHeight - height));
    const top = kind === 'header' ? edgeOffset : page.box.height - edgeOffset - height;
    band.style.position = 'absolute';
    band.style.left = `${(page.contentBox.x - page.box.x) * options.scale}px`;
    band.style.top = `${top * options.scale}px`;
    band.style.width = `${page.contentBox.width * options.scale}px`;
    band.style.height = `${height * options.scale}px`;
    element.append(band);
  }

  for (const story of [page.header, page.footer]) {
    if (!story) continue;
    const anchored = story.anchoredDrawings ?? [];
    appendHfPageRelativeDrawingLayer(
      document,
      element,
      story,
      anchored,
      options,
      pageOrigin,
      'behind'
    );
    const container = document.createElement('div');
    container.className = 'docx-hf';
    container.dataset.docxHf = story.kind;
    if (story.rId) container.dataset.docxRId = story.rId;
    const active =
      !!options.activeHeaderFooterRId &&
      !!story.rId &&
      options.activeHeaderFooterRId === story.rId &&
      (options.activeHeaderFooterPageIndex === undefined ||
        options.activeHeaderFooterPageIndex === page.index);
    if (active) {
      container.dataset.docxHfActive = '';
      container.setAttribute('contenteditable', 'true');
    } else {
      container.setAttribute('contenteditable', 'false');
    }
    container.style.position = 'absolute';
    container.style.left = `${(story.box.x - page.box.x) * options.scale}px`;
    container.style.top = `${(story.box.y - page.box.y) * options.scale}px`;
    container.style.width = `${story.box.width * options.scale}px`;
    container.style.height = `${story.box.height * options.scale}px`;
    container.style.overflow = 'hidden';
    const storyOrigin = Object.freeze({
      x: 0,
      y: 0,
      width: story.box.width,
      height: story.box.height,
    });
    const storyRelative = anchored.filter((drawing) => !isPageRelativeHfAnchor(drawing));
    appendAnchoredDrawingsForRecords(
      document,
      container,
      storyRelative,
      asResolvedPaintContext(options),
      storyOrigin,
      'behind'
    );
    // Furniture links paint styled but inert — see `paintHyperlinkAnchor`.
    const furnitureCtx: ResolvedPaintContext = {
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
    appendAnchoredDrawingsForRecords(
      document,
      container,
      storyRelative,
      asResolvedPaintContext(options),
      storyOrigin,
      'inFront'
    );
    element.append(container);
    // Hover invitation for an EXISTING band: a pill just outside the story box, shown by
    // CSS only while the adjacent band is hovered (`.docx-hf:hover + .docx-hf-edit-hint`).
    // Outside the band because the band clips (`overflow: hidden`) and its content would
    // sit under the pill. Adjacency is load-bearing — keep this append right here.
    const hint = document.createElement('div');
    hint.className = 'docx-hf-edit-hint';
    hint.dataset.docxHfHint = story.kind;
    hint.setAttribute('contenteditable', 'false');
    hint.style.position = 'absolute';
    hint.style.left = container.style.left;
    hint.style.width = container.style.width;
    hint.style.top =
      story.kind === 'header'
        ? `${(story.box.y + story.box.height - page.box.y) * options.scale}px`
        : `${(story.box.y - page.box.y) * options.scale}px`;
    if (story.kind === 'footer') hint.style.transform = 'translateY(-100%)';
    element.append(hint);
    appendHfPageRelativeDrawingLayer(
      document,
      element,
      story,
      anchored,
      options,
      pageOrigin,
      'inFront'
    );
  }

  paintContentControlChrome(document, element, page, options);
  return element;
}

/** Height of the blank header/footer invitation band, in points (~two text lines). */
const PLACEHOLDER_BAND_PT = 30;
/** Where the band starts from the sheet edge — `w:pgMar` header/footer default (720 twips). */
const PLACEHOLDER_DISTANCE_PT = 36;

/** Widget kinds the painted surface can activate without adapter chrome. */
const WIDGET_TYPES = new Set<ContentControlMappedType>([
  'dropdown',
  'comboBox',
  'date',
  'checkbox',
]);

/**
 * Paint on-demand content-control boundary furniture onto a page sheet.
 *
 * Absolute-positioned over the sheet (page coordinates), never inside flowing content —
 * so toggling chrome cannot reflow. `data-docx-marker` excludes the nodes from native
 * selection mapping; `contenteditable=false` keeps them furniture.
 */
function paintContentControlChrome(
  document: Document,
  pageElement: HTMLElement,
  page: PageRecord,
  options: {
    readonly scale: number;
    readonly contentControlChrome?: PaintOptions['contentControlChrome'];
  }
): void {
  const chrome = options.contentControlChrome;
  const suppressed = chrome?.suppressedIds;
  const pageControls = (page.contentControls ?? []).filter(
    (control) => suppressed?.has(control.id) !== true
  );
  const controls = [
    ...pageControls,
    ...(chrome?.additionalBoundaries ?? []).filter(
      (candidate) =>
        suppressed?.has(candidate.id) !== true &&
        !pageControls.some((control) => control.id === candidate.id)
    ),
  ];
  if (controls.length === 0) return;
  const showAll = chrome?.showAll === true;
  const activeIds = chrome?.activeIds;
  const hoverIds = chrome?.hoverIds;
  const tocControlIds = chrome?.tocControlIds;
  for (const control of controls) {
    const isToc = tocControlIds?.has(control.id) === true;
    const active = !isToc && activeIds?.has(control.id) === true;
    const hovered = hoverIds?.has(control.id) === true;
    pageElement.append(
      paintContentControlBoundary(
        document,
        page,
        control,
        options.scale,
        active,
        hovered,
        showAll || active || (isToc && hovered),
        chrome?.checkedIds?.has(control.id),
        isToc
      )
    );
  }
}

function paintContentControlBoundary(
  document: Document,
  page: PageRecord,
  control: ContentControlBoundaryRecord,
  scale: number,
  active: boolean,
  hovered: boolean,
  boundaryVisible: boolean,
  checked: boolean | undefined,
  isToc: boolean
): HTMLElement {
  const layer = document.createElement('div');
  layer.className = 'docx-content-control-chrome';
  layer.dataset.docxContentControl = control.id;
  layer.dataset.docxMarker = '';
  layer.dataset.controlType = control.controlType;
  layer.dataset.lock = control.effectiveLock;
  if (control.bound) layer.dataset.bound = '';
  if (control.placeholder) layer.dataset.placeholder = '';
  if (isToc) layer.dataset.docxToc = '';
  if (active) layer.dataset.active = '';
  if (hovered) layer.dataset.hover = '';
  if (boundaryVisible) layer.dataset.boundaryVisible = '';
  layer.setAttribute('contenteditable', 'false');
  layer.setAttribute('role', 'group');
  // Alias and tag are document-authored control metadata.
  if (control.alias) layer.dataset.alias = control.alias;
  if (control.tag) layer.dataset.tag = control.tag;
  if (control.alias) layer.setAttribute('aria-label', control.alias);
  layer.style.position = 'absolute';
  layer.style.inset = '0';
  layer.style.pointerEvents = 'none';
  layer.style.zIndex = '2';

  // Boundary fragments use the same page-CONTENT coordinate space as paragraph/table
  // fragments. This chrome layer is parented to the SHEET so it does not affect editable
  // content or DOM-selection child indices, therefore translate through the content-box
  // origin before painting. Omitting this offset puts every control in the page's top-left
  // margin (and is especially obvious for controls inside table cells).
  const contentLeft = page.contentBox.x - page.box.x;
  const contentTop = page.contentBox.y - page.box.y;
  for (const fragment of control.fragments) {
    if (fragment.pageIndex !== page.index) continue;
    const box = document.createElement('div');
    box.className = 'docx-content-control-boundary';
    box.dataset.docxMarker = '';
    box.setAttribute('contenteditable', 'false');
    box.setAttribute('aria-hidden', 'true');
    box.style.position = 'absolute';
    box.style.left = `${(contentLeft + fragment.box.x) * scale}px`;
    box.style.top = `${(contentTop + fragment.box.y) * scale}px`;
    box.style.width = `${Math.max(fragment.box.width, 1) * scale}px`;
    box.style.height = `${Math.max(fragment.box.height, 1) * scale}px`;
    box.style.pointerEvents = 'none';
    layer.append(box);
  }

  const first = control.fragments.find((fragment) => fragment.pageIndex === page.index);
  if (first && control.alias) {
    const label = document.createElement('div');
    label.className = 'docx-content-control-label';
    label.dataset.docxMarker = '';
    label.setAttribute('contenteditable', 'false');
    label.setAttribute('aria-hidden', 'true');
    label.textContent = control.alias;
    label.style.position = 'absolute';
    label.style.left = `${(contentLeft + first.box.x) * scale}px`;
    label.style.top = `${Math.max(0, (contentTop + first.box.y) * scale - 16)}px`;
    label.style.pointerEvents = 'none';
    layer.append(label);
  }
  if (first && WIDGET_TYPES.has(control.controlType)) {
    const widget = document.createElement('button');
    widget.type = 'button';
    widget.className = 'docx-content-control-widget';
    widget.dataset.docxMarker = '';
    widget.dataset.docxCcWidget = control.controlType;
    widget.dataset.docxCcId = control.id;
    widget.setAttribute('contenteditable', 'false');
    widget.setAttribute('tabindex', '-1');
    // Role / name / value come from data + state; adapters localize labels.
    if (control.controlType === 'checkbox') widget.setAttribute('role', 'checkbox');
    else if (control.controlType === 'dropdown' || control.controlType === 'comboBox') {
      widget.setAttribute('role', 'listbox');
    } else if (control.controlType === 'date') {
      widget.setAttribute('role', 'button');
    }
    if (control.alias) widget.dataset.name = control.alias;
    if (control.alias) widget.setAttribute('aria-label', control.alias);
    if (control.controlType === 'checkbox') {
      widget.setAttribute('data-checked', checked ? 'true' : 'false');
      widget.setAttribute('aria-checked', checked ? 'true' : 'false');
    }
    const contentLocked =
      control.effectiveLock === 'contentLocked' || control.effectiveLock === 'sdtContentLocked';
    if (contentLocked || control.bound) {
      widget.disabled = true;
      widget.dataset.disabledReason = control.bound ? 'bound' : 'locked';
      widget.setAttribute('aria-disabled', 'true');
    }
    widget.style.position = 'absolute';
    widget.style.left = `${(contentLeft + first.box.x + first.box.width) * scale - 18}px`;
    widget.style.top = `${(contentTop + first.box.y) * scale}px`;
    widget.style.width = '16px';
    widget.style.height = '16px';
    widget.style.pointerEvents = 'auto';
    widget.style.padding = '0';
    widget.style.margin = '0';
    widget.style.cursor = widget.disabled ? 'not-allowed' : 'pointer';
    layer.append(widget);
  }

  return layer;
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

function sameBox(left: PageRecord['box'], right: PageRecord['box']): boolean {
  return (
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height
  );
}

function virtualPageShellMatches(
  retained: RetainedPage,
  page: PageRecord,
  scale: number,
  ariaHidden: boolean
): boolean {
  const element = retained.element;
  return (
    !retained.materialized &&
    sameBox(retained.record.box, page.box) &&
    element.style.left === `${page.box.x * scale}px` &&
    element.style.top === `${page.box.y * scale}px` &&
    element.style.width === `${page.box.width * scale}px` &&
    element.style.height === `${page.box.height * scale}px` &&
    element.getAttribute('aria-hidden') === (ariaHidden ? 'true' : null)
  );
}

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
  const chrome = options.contentControlChrome;
  // `hoverIds` is absent ON PURPOSE — see its doc comment. Including it made a pointer
  // entering a TOC rebuild every page, which detached the node the gesture started on.
  const chromeKey = chrome
    ? `${chrome.showAll === true ? '1' : '0'}:${chrome.activeIds ? [...chrome.activeIds].sort().join(',') : ''}:${chrome.checkedIds ? [...chrome.checkedIds].sort().join(',') : ''}:${chrome.tocControlIds ? [...chrome.tocControlIds].sort().join(',') : ''}:${chrome.suppressedIds ? [...chrome.suppressedIds].sort().join(',') : ''}`
    : '';
  const drawingStrings = options.drawingStrings ?? DEFAULT_DRAWING_PAINT_STRINGS;
  const urlRegistry =
    options.imageUrlPort !== undefined
      ? drawingUrlRegistryFor(container, options.imageUrlPort)
      : null;
  const additionalKey = chrome?.additionalBoundaries
    ? chrome.additionalBoundaries
        .flatMap((boundary) =>
          boundary.fragments.map(
            (fragment) =>
              `${boundary.id}:${fragment.pageIndex}:${fragment.box.x}:${fragment.box.y}:${fragment.box.width}:${fragment.box.height}`
          )
        )
        .sort()
        .join(',')
    : '';
  const readOnlyKey = options.readOnlyParagraphIds
    ? [...options.readOnlyParagraphIds].sort().join(',')
    : '';
  const emptyTocKey = options.emptyTocPlaceholderIds
    ? [...options.emptyTocPlaceholderIds].sort().join(',')
    : '';
  const tocKey = chrome?.tocControlIds ? [...chrome.tocControlIds].sort().join(',') : '';
  const resolved = {
    scale: options.scale ?? 96 / 72,
    ariaHidden: options.ariaHidden ?? true,
    drawingStrings,
    urlRegistry,
    ...(options.fontAlias ? { fontAlias: options.fontAlias } : {}),
    ...(options.readOnlyParagraphIds ? { readOnlyParagraphIds: options.readOnlyParagraphIds } : {}),
    ...(options.emptyTocPlaceholderIds
      ? { emptyTocPlaceholderIds: options.emptyTocPlaceholderIds }
      : {}),
    ...(options.defaultFontFamily ? { defaultFontFamily: options.defaultFontFamily } : {}),
    authorSlots: authorSlotsOf(layout),
    ...(options.imageUrlPort ? { imageUrlPort: options.imageUrlPort } : {}),
    ...(options.activeHeaderFooterRId
      ? { activeHeaderFooterRId: options.activeHeaderFooterRId }
      : {}),
    ...(options.activeHeaderFooterPageIndex !== undefined
      ? { activeHeaderFooterPageIndex: options.activeHeaderFooterPageIndex }
      : {}),
    ...(chrome ? { contentControlChrome: chrome } : {}),
  } satisfies ResolvedPaintContext & {
    ariaHidden: boolean;
    activeHeaderFooterRId?: string;
    activeHeaderFooterPageIndex?: number;
  };
  const document = container.ownerDocument;
  // The alias lookup is part of the paint parameters: a page painted before fonts
  // registered must not be reused verbatim afterwards. Occurrence page is included so
  // moving the caret host across shared furniture copies rebuilds active markers.
  // Content-control chrome is furniture only, but toggling it must rebuild painted pages
  // so show-all / caret chrome appear. Hover is the one exception: it is applied to the
  // painted nodes in place, because a pointer crossing a region may not move it.
  const parameters =
    `${resolved.scale}|${resolved.ariaHidden}|` +
    `${resolved.fontAlias ? aliasIdentity(resolved.fontAlias) : ''}|` +
    `${resolved.defaultFontFamily ?? ''}|` +
    `${resolved.activeHeaderFooterRId ?? ''}|` +
    `${resolved.activeHeaderFooterPageIndex ?? ''}|` +
    `cc:${chromeKey}:${additionalKey}|toc:${tocKey}|` +
    `ro:${readOnlyKey}|tocEmpty:${emptyTocKey}|` +
    `${options.imageUrlPort ? 'url' : ''}|` +
    `${drawingPaintStringsCacheToken(drawingStrings)}`;
  const previous = retainedPaints.get(container);
  const parametersUnchanged = previous?.parameters === parameters;
  const reusable = parametersUnchanged
    ? new Map(previous.pages.map((entry) => [entry.record, entry]))
    : null;
  const previousByIndex = previous
    ? new Map(previous.pages.map((entry) => [entry.record.index, entry]))
    : null;

  const pages: RetainedPage[] = layout.pages.map((page) => {
    const materialized = options.materialize?.has(page.index) ?? true;
    const kept = reusable?.get(page);
    if (kept && kept.materialized === materialized) return kept;
    const priorShell = materialized ? null : previousByIndex?.get(page.index);
    if (
      priorShell &&
      virtualPageShellMatches(priorShell, page, resolved.scale, resolved.ariaHidden)
    ) {
      return { record: page, materialized: false, element: priorShell.element };
    }
    return {
      record: page,
      materialized,
      element: paintPage(document, page, resolved, materialized),
    };
  });
  retainedPaints.set(container, { parameters, pages });
  container.dataset.revision = String(layout.revision);

  if (urlRegistry) {
    urlRegistry.reconcile(
      collectUsedDrawingResourceKeys(layout),
      collectUsedDrawingElementKeys(layout)
    );
  }

  // Keyed reconcile instead of `replaceChildren`: retained elements stay where they are —
  // keeping the browser's style and layout for them, and the DOM selection anchored inside
  // them — while changed pages are placed in order and anything else is dropped.
  const kept = new Set<HTMLElement>(pages.map((entry) => entry.element));
  let child = container.firstChild;
  while (child) {
    const next = child.nextSibling;
    // Drop stale pages first. Leaving them in front of retained virtual shells makes the
    // ordering pass move every shell out and back on each keystroke.
    if (!kept.has(child as HTMLElement)) (child as ChildNode).remove();
    child = next;
  }
  let cursor = container.firstChild;
  for (const entry of pages) {
    if (entry.element === cursor) {
      cursor = cursor.nextSibling;
      continue;
    }
    container.insertBefore(entry.element, cursor);
  }
}

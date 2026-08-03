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

import { baselineShiftPtOf } from '@docx-editor.dev/core-contract/layout';
import type {
  LineRecord,
  PageRecord,
  ParagraphBorderStrokeRecord,
  ParagraphFragmentRecord,
  ResolvedRunStyle,
  SemanticLayout,
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

function paintSpan(
  document: Document,
  span: StyleSpanRecord,
  ctx: PaintContext,
  bandHeightPt: number
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
  // The box is only its own size if the run does NOT inherit the line's pixel line-height:
  // inherited, every run's inner line box is the full line height and the band is one
  // uniform slab again. The caller passes the height this run's band should be (its own
  // published height, plus the line's extra leading, capped at the line height).
  element.style.lineHeight = `${bandHeightPt * ctx.scale}px`;
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
  }
  mountRunText(document, element, span.text, span.style, ctx.scale);
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
  let tallest = 0;
  for (const span of line.spans) tallest = Math.max(tallest, span.box.height);
  const leading = Math.max(0, line.box.height - tallest);
  for (const span of line.spans) {
    const band = Math.min(span.box.height + leading, line.box.height);
    element.append(paintSpan(document, span, ctx, band));
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
  element.style.fontSize = '0';
  element.style.lineHeight = `${marker.box.height * scale}px`;
  const glyph = document.createElement('span');
  glyph.style.display = 'inline-block';
  glyph.style.verticalAlign = 'baseline';
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
const TAB_LEADER_GLYPH = new Map<string, string>(
  Object.entries({
    dot: '.',
    hyphen: '-',
    underscore: '_',
    heavy: '_',
    middleDot: '·',
  })
);

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
  // The zero-size strut plus an explicit line-height is how `paintLine` sits its runs, so
  // reusing it here puts the leader on exactly the baseline the text on this line got.
  layer.style.fontSize = '0';
  layer.style.lineHeight = `${line.box.height * scale}px`;

  const glyphs = document.createElement('span');
  glyphs.style.display = 'inline-block';
  glyphs.style.verticalAlign = 'baseline';
  applyRunFaceStyle(glyphs, span.style, ctx);
  if (span.tabLeader === 'heavy') glyphs.style.fontWeight = 'bold';
  // Under-estimate the glyph advance at a fifth of the em so the repeat always OVERFILLS the
  // reserved width; the clip decides where it ends, which is what keeps the leader from
  // stopping short of the stop in a face with narrow punctuation.
  const advancePt = Math.max(0.5, span.style.fontSizePt * 0.2);
  const count = Math.min(MAX_TAB_LEADER_GLYPHS, Math.ceil(span.box.width / advancePt) + 1);
  glyphs.textContent = glyph.repeat(count); // SAFE: textContent, never innerHTML
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

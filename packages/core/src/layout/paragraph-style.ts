// Resolved paragraph spacing and borders for semantic layout (task 7.3).
//
// Twips and eighth-points leave here as POINTS. Layout places from these numbers; paint
// only draws them. Unrecognised or hostile values are dropped or clamped rather than
// guessed — a wrong before-spacing moves every subsequent page break.

import {
  twips,
  twipsToPoints,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlProperty,
} from '@docx-editor.dev/core/store';
import { borderStrokeWidthPt } from './border-metrics.ts';

/**
 * Whether a paragraph must start a new page (`w:pageBreakBefore`).
 *
 * LAST WINS, like every other toggle read off the cascade (`paragraphKeeps` does the same
 * for `w:keepNext`). An any-wins `.some()` cannot be switched off: a Chapter or Heading style
 * carries `w:pageBreakBefore`, and Word writes `w:val="0"` on the one instance whose author
 * unchecked the box — that paragraph still broke, so the document grew a blank page and every
 * page number after it was wrong.
 *
 * An absent `w:val` is on (§17.17.4), and the off vocabulary is the whole of it — `off` is a
 * spelling too, which {@link isOn} beside this already accepts.
 */
export function paragraphBreaksBefore(props: readonly OoxmlProperty[]): boolean {
  let breaks = false;
  for (const property of props) {
    if (property.localName !== 'pageBreakBefore') continue;
    const val = property.attributes?.val;
    breaks = val === undefined || isOn(val);
  }
  return breaks;
}

/**
 * Soft ceiling matching the spike's resolved-style limit (31_680 twips ≈ 22"). Beyond
 * that an attacker-authored spacing would push pagination into pathological page counts.
 */
export const MAX_PARAGRAPH_SPACING_PT = 31_680 / 20;

/** Soft ceiling on border width (96 eighths = 12pt). Word's UI tops out well below this. */
export const MAX_BORDER_WIDTH_PT = 12;

/** Soft ceiling on border-to-text gap (`w:space`, already in points). */
export const MAX_BORDER_SPACE_PT = 3168;

/**
 * A paragraph's resolved space before and after, in points.
 *
 * Already collapsed against `w:contextualSpacing`, so adjacent same-style paragraphs that suppress
 * their gap arrive here with it removed rather than leaving that to whoever stacks them.
 */
export interface ParagraphSpacing {
  /** `w:spacing/@before`, in points. */
  readonly before: number;
  /** `w:spacing/@after`, in points. */
  readonly after: number;
}

/**
 * The gap Word substitutes when `w:beforeAutospacing` / `w:afterAutospacing` is on
 * (ECMA-376 §17.3.1.33, the `w:spacing` clause both attributes belong to).
 *
 * The attribute means "the consumer decides", and the authored `@before` / `@after` beside it
 * is IGNORED rather than used as the value. Word's answer is HTML's default `<p>` margin,
 * 14pt, which is what a document round-tripped through Word's HTML filter carries — and this
 * one is everywhere, because Word writes `w:before="100" w:beforeAutospacing="1"` for it. Reading
 * only the literal 100 twips lays every such paragraph out 9pt tight, which moves page breaks.
 */
export const AUTO_PARAGRAPH_SPACING_PT = 14;

/**
 * Where a paragraph sits, for the two contexts in which Word's auto spacing resolves to 0
 * instead of {@link AUTO_PARAGRAPH_SPACING_PT}.
 *
 * Both come from the HTML model the attribute emulates: a `<li>` and a `<td>` collapse the
 * paragraph margin, a bare `<p>` does not. A caller that says nothing gets the body answer.
 */
export interface ParagraphAutoSpacingContext {
  /** The paragraph participates in numbering (`w:numPr`), i.e. it is a list item. */
  readonly inList?: boolean;
  /** The paragraph lives in a table cell. */
  readonly inTableCell?: boolean;
}

/**
 * Resolved line spacing (`w:spacing/@line` + `@lineRule`, ECMA-376 17.3.1.33).
 *
 * `auto` is the interesting one: `@line` is 240ths of a line, so 240 is single, 360 is
 * one-and-a-half, 480 is double — and Word's own Normal style since 2013 is 259, i.e.
 * 1.08. A document laid out at a flat single spacing is ~8% tight on EVERY line, which
 * moves every page break, so this is not a cosmetic detail.
 *
 * `exact` fixes the line box at `@line` twips and lets tall glyphs clip, the way Word
 * does. `atLeast` uses it as a floor.
 */
export type LineSpacingRule = 'auto' | 'exact' | 'atLeast';

/**
 * Resolved line spacing: the rule, and the value it applies.
 *
 * `value` means different things per rule — 240ths of a line under `auto`, points under `exact`
 * and `atLeast` — which is why the two travel together and neither is useful alone.
 */
export interface ParagraphLineSpacing {
  readonly rule: LineSpacingRule;
  /** `auto`: the 240ths-of-a-line multiplier numerator. Otherwise points. */
  readonly value: number;
}

/** Single spacing: what a paragraph that says nothing gets. */
export const SINGLE_LINE_SPACING: ParagraphLineSpacing = Object.freeze({
  rule: 'auto' as const,
  value: 240,
});

/**
 * Word's Format > Paragraph tops out at 132pt exact/atLeast and "Multiple 132". The
 * ceilings here are wider than the UI but bounded: `@line` is attacker-controlled and
 * becomes a line height, and an unbounded one paginates a short document into millions of
 * sheets.
 */
const MAX_LINE_SPACING_MULTIPLE = 132;
const MAX_LINE_SPACING_PT = 132 * 12;

/**
 * One resolved `w:pBdr` edge: its style, colour, thickness and gap.
 *
 * `widthPt` and `spacePt` are already converted and CLAMPED — both come from a file, and an
 * unbounded border width becomes a layout dimension.
 */
export interface ParagraphBorderEdge {
  /** Authored `ST_Border` value (`single`, `dashed`, …). */
  readonly val: string;
  /** RRGGBB, or null when auto/missing (paint defaults to black). */
  readonly color: string | null;
  /** Border thickness in points (`w:sz` is eighths of a point). */
  readonly widthPt: number;
  /** Gap from text to the rule, in points (`w:space`). */
  readonly spacePt: number;
  /**
   * `w:shadow` — Word offsets a drop shadow behind the rule.
   *
   * Present only when authored true, so an edge that says nothing keeps the shape earlier
   * fixtures assert. Resolved and carried; drawing it is deferred.
   */
  readonly shadow?: true;
}

/** The six `CT_PBdr` children, in schema order (ECMA-376 §17.3.1.24). */
export const PARAGRAPH_BORDER_SIDES = ['top', 'left', 'bottom', 'right', 'between', 'bar'] as const;

/**
 * Which of the six `CT_PBdr` edges.
 *
 * Four are physical box edges; `between` and `bar` are group-relative, drawn only where
 * consecutive paragraphs share a border definition.
 */
export type ParagraphBorderSide = (typeof PARAGRAPH_BORDER_SIDES)[number];

/**
 * A paragraph's resolved `w:pBdr` (ECMA-376 §17.3.1.24).
 *
 * `top`/`left`/`bottom`/`right` are the four physical edges of the box. The other two are
 * group-relative: `between` draws at a boundary INSIDE a run of consecutive paragraphs whose
 * border settings are identical, and `bar` is the vertical change-bar rule beside the
 * paragraph, drawn whether or not the paragraph groups with its neighbours.
 */
export interface ParagraphBorders {
  readonly top?: ParagraphBorderEdge;
  readonly left?: ParagraphBorderEdge;
  readonly bottom?: ParagraphBorderEdge;
  readonly right?: ParagraphBorderEdge;
  readonly between?: ParagraphBorderEdge;
  readonly bar?: ParagraphBorderEdge;
}

/** A paragraph that declares no `w:pBdr` at all, shared so the common case allocates nothing. */
const NO_PARAGRAPH_BORDERS: ParagraphBorders = Object.freeze({});

const HEX_COLOR = /^[0-9A-Fa-f]{6}$/;

/** `nil`/`none` suppress a border; anything else with a recognised thickness paints. */
const NO_BORDER = new Set(['nil', 'none']);

function integer(raw: string | undefined, allowNegative = false): number | null {
  if (raw === undefined) return null;
  // Up to 9 digits so oversized authored values reach the clamp rather than being dropped
  // as "non-numeric"; beyond that is garbage, not a measurement.
  if (!(allowNegative ? /^-?\d{1,9}$/ : /^\d{1,9}$/).test(raw)) return null;
  return Number(raw);
}

function clampNonNegative(value: number, max: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return value > max ? max : value;
}

/** Authored twips attribute to clamped spacing points, through the one conversion pair. */
function spacingPoints(raw: string | undefined): number {
  const authored = integer(raw, true);
  if (authored === null) return 0;
  return clampNonNegative(twipsToPoints(twips(authored)), MAX_PARAGRAPH_SPACING_PT);
}

/** `ST_OnOff` carried as an attribute value: anything but an explicit off is on (§17.17.4). */
function isOn(raw: string): boolean {
  return raw !== '0' && raw !== 'false' && raw !== 'off';
}

function hexColor(raw: string | undefined): string | null {
  if (raw === undefined || raw === 'auto') return null;
  return HEX_COLOR.test(raw) ? raw.toUpperCase() : null;
}

function attributeValue(node: OoxmlElement, localName: string): string | undefined {
  return node.attributes.find((attribute) => attribute.localName === localName)?.value;
}

function childNamed(node: OoxmlElement, localName: string): OoxmlElement | undefined {
  for (const child of node.children) {
    if (child.kind !== 'textValue' && child.localName === localName) return child;
  }
  return undefined;
}

/**
 * Fold every entry of one `w:pPr` element name in a FLATTENED CASCADE into one attribute bag.
 *
 * A cascaded property list carries one entry per level — `w:docDefaults`, then each style in
 * the `basedOn` chain, then the paragraph's own `w:pPr` — in that order, LOWEST PRECEDENCE
 * FIRST. `Array.prototype.find` therefore answers the document's defaults and never the
 * paragraph's own formatting, which is the wrong end of the list: read that way, a paragraph
 * that had just been given 24pt of space before still reported the 8pt its `w:docDefaults`
 * set.
 *
 * Attributes merge INDEPENDENTLY, the rule {@link paragraphSpacing} and
 * {@link paragraphLineSpacing} already follow: `w:spacing` carries the line rule, the space
 * before and the space after in one element, and a style that states `w:before` alone must
 * leave the `w:after` an earlier level set in place.
 *
 * Returns null when no level states the element at all — not the same as one stating it with
 * no attributes.
 */
export function cascadedParagraphAttributes(
  props: readonly OoxmlProperty[],
  localName: string
): Readonly<Record<string, string>> | null {
  let merged: Record<string, string> | null = null;
  for (const property of props) {
    if (property.localName !== localName) continue;
    merged = { ...(merged ?? {}), ...(property.attributes ?? {}) };
  }
  return merged;
}

/**
 * Resolve `w:spacing` before/after from flat paragraph properties.
 *
 * Line spacing (`w:line` / `w:lineRule`) is a separate concern — it changes measured line
 * height, not the gap between paragraphs — and is not resolved here.
 *
 * `w:beforeAutospacing` / `w:afterAutospacing` REPLACE the authored measurement on their own
 * side rather than adding to it; see {@link AUTO_PARAGRAPH_SPACING_PT}.
 */
export function paragraphSpacing(
  props: readonly OoxmlProperty[],
  context?: ParagraphAutoSpacingContext
): ParagraphSpacing {
  let before = 0;
  let after = 0;
  let beforeAuto = false;
  let afterAuto = false;
  for (const property of props) {
    if (property.localName !== 'spacing') continue;
    // Merged PER ATTRIBUTE, not per element. `w:spacing` is one element carrying
    // independent attributes, and a later entry in the cascade overrides only what it
    // actually states: a style that sets `w:before` alone must not erase the `w:after`
    // that `w:docDefaults` set, which is exactly the shape Word's own Heading styles have.
    const authoredBefore = property.attributes?.before;
    const authoredAfter = property.attributes?.after;
    if (authoredBefore !== undefined) before = spacingPoints(authoredBefore);
    if (authoredAfter !== undefined) after = spacingPoints(authoredAfter);
    // The autospacing flags merge per attribute too, and independently of the measurement
    // beside them: a style may turn auto spacing OFF while leaving the `@before` it inherited
    // in place, and that paragraph must then use the measurement, not 0.
    const authoredBeforeAuto = property.attributes?.beforeAutospacing;
    const authoredAfterAuto = property.attributes?.afterAutospacing;
    if (authoredBeforeAuto !== undefined) beforeAuto = isOn(authoredBeforeAuto);
    if (authoredAfterAuto !== undefined) afterAuto = isOn(authoredAfterAuto);
  }
  if (beforeAuto || afterAuto) {
    const auto = context?.inList || context?.inTableCell ? 0 : AUTO_PARAGRAPH_SPACING_PT;
    if (beforeAuto) before = auto;
    if (afterAuto) after = auto;
  }
  return { before, after };
}

/**
 * Resolve `w:line` / `w:lineRule` from flat paragraph properties.
 *
 * Merged per attribute for the same reason as before/after: `w:spacing` is one element
 * carrying independent attributes, and a style that states only `@line` must not reset the
 * rule an earlier entry in the cascade set.
 */
export function paragraphLineSpacing(props: readonly OoxmlProperty[]): ParagraphLineSpacing {
  let rule: LineSpacingRule | undefined;
  let line: number | undefined;
  for (const property of props) {
    if (property.localName !== 'spacing') continue;
    const authoredRule = property.attributes?.lineRule;
    if (authoredRule === 'auto' || authoredRule === 'exact' || authoredRule === 'atLeast') {
      rule = authoredRule;
    }
    const authoredLine = property.attributes?.line;
    if (authoredLine !== undefined) {
      const twips = integer(authoredLine, true);
      if (twips !== null) line = twips;
    }
  }
  if (line === undefined) return SINGLE_LINE_SPACING;
  // Absent `@lineRule` with a present `@line` defaults to `auto` (17.3.1.33).
  const effective = rule ?? 'auto';
  if (effective === 'auto') {
    const multiple = line / 240;
    if (!(multiple > 0)) return SINGLE_LINE_SPACING;
    return { rule: 'auto', value: Math.min(multiple, MAX_LINE_SPACING_MULTIPLE) * 240 };
  }
  // A negative or zero exact/atLeast is not a line box Word would draw; fall back rather
  // than paginate into a zero-height column.
  const points = line / 20;
  if (!(points > 0)) return SINGLE_LINE_SPACING;
  return { rule: effective, value: Math.min(points, MAX_LINE_SPACING_PT) };
}

/**
 * Apply resolved line spacing to a line's natural (glyph-derived) box.
 *
 * Word places `auto` / `atLeast` extras BELOW the line (the last line's multiple spacing
 * still separates it from the next paragraph). Putting that delta above inverted cover-page
 * rhythm: `w:line="460"` on "between" opened a large gap above the word and almost none
 * before "MERIDIAN". `exact` taller than the glyphs centers the text (ECMA-376 17.3.1.33).
 * An `exact` box smaller than the glyphs keeps the baseline inside so clipped text still
 * sits on it.
 */
export function applyLineSpacing(
  spacing: ParagraphLineSpacing,
  naturalHeight: number,
  naturalBaseline: number
): { height: number; baseline: number } {
  const height =
    spacing.rule === 'auto'
      ? naturalHeight * (spacing.value / 240)
      : spacing.rule === 'exact'
        ? spacing.value
        : Math.max(naturalHeight, spacing.value);
  const delta = height - naturalHeight;
  if (delta < 0) {
    return { height, baseline: Math.max(0, Math.min(naturalBaseline, height)) };
  }
  if (spacing.rule === 'exact') {
    return { height, baseline: naturalBaseline + delta / 2 };
  }
  // auto / atLeast: grow the box downward; baseline stays put.
  return { height, baseline: naturalBaseline };
}

/**
 * `w:contextualSpacing` (17.3.1.9): drop before/after between paragraphs of the SAME
 * style. Word's built-in `ListParagraph` sets it, so every list authored in Word gets a
 * paragraph gap between items without this.
 */
export function paragraphContextualSpacing(props: readonly OoxmlProperty[]): boolean {
  let value = false;
  for (const property of props) {
    if (property.localName !== 'contextualSpacing') continue;
    const raw = property.attributes?.val;
    value = raw === undefined || isOn(raw);
  }
  return value;
}

function resolveBorderEdge(node: OoxmlElement | undefined): ParagraphBorderEdge | undefined {
  if (!node) return undefined;
  const val = attributeValue(node, 'val');
  if (!val || NO_BORDER.has(val)) return undefined;

  // `w:sz` is eighths of a point. Missing size yields a hairline so a border that declares
  // a style but no thickness still paints — matching Word's default of ½pt for bare edges.
  const eighths = integer(attributeValue(node, 'sz'));
  const widthPt =
    eighths === null ? 0.5 : clampNonNegative(eighths / 8, MAX_BORDER_WIDTH_PT) || 0.5;

  const spaceRaw = integer(attributeValue(node, 'space'));
  const spacePt = spaceRaw === null ? 0 : clampNonNegative(spaceRaw, MAX_BORDER_SPACE_PT);

  const shadow = attributeValue(node, 'shadow');
  const hasShadow =
    shadow !== undefined && shadow !== '0' && shadow !== 'false' && shadow !== 'off';

  return {
    val,
    color: hexColor(attributeValue(node, 'color')),
    widthPt,
    spacePt,
    ...(hasShadow ? { shadow: true as const } : {}),
  };
}

/**
 * Every edge of one `w:pBdr` element.
 *
 * `w:start`/`w:end` are the logical-direction synonyms some producers write instead of
 * `w:left`/`w:right`; the physical name wins when a file states both, because that is the
 * one the transitional schema (§17.3.1.24) actually declares.
 */
function bordersOfElement(pBdr: OoxmlElement): ParagraphBorders {
  const top = resolveBorderEdge(childNamed(pBdr, 'top'));
  const left = resolveBorderEdge(childNamed(pBdr, 'left') ?? childNamed(pBdr, 'start'));
  const bottom = resolveBorderEdge(childNamed(pBdr, 'bottom'));
  const right = resolveBorderEdge(childNamed(pBdr, 'right') ?? childNamed(pBdr, 'end'));
  const between = resolveBorderEdge(childNamed(pBdr, 'between'));
  const bar = resolveBorderEdge(childNamed(pBdr, 'bar'));
  return {
    ...(top ? { top } : {}),
    ...(left ? { left } : {}),
    ...(bottom ? { bottom } : {}),
    ...(right ? { right } : {}),
    ...(between ? { between } : {}),
    ...(bar ? { bar } : {}),
  };
}

/**
 * Resolve `w:pBdr` from the paragraph-properties node.
 *
 * Nested — every edge is a child of `pBdr`, not an attribute — so this reads the typed tree
 * rather than the flattened `OoxmlProperty[]` bag `propertiesOf` builds for leaf props.
 */
export function paragraphBorders(pPr: OoxmlNode | undefined): ParagraphBorders {
  if (!pPr || pPr.kind === 'textValue') return {};
  const pBdr = childNamed(pPr, 'pBdr');
  if (!pBdr) return {};
  return bordersOfElement(pBdr);
}

/**
 * `w:pBdr` after the style cascade: a later `w:pBdr` replaces an earlier one WHOLESALE.
 *
 * Word does not merge edges across the cascade. A style that states only `w:bottom` discards
 * the box its `basedOn` ancestor declared, so folding edge by edge would leave a lone
 * underline surrounded by a box no one authored. Absence inherits; `nil`/`none` clear.
 */
export function cascadedParagraphBorders(
  paragraphPropertyNodes: readonly OoxmlNode[]
): ParagraphBorders {
  let borders: ParagraphBorders = NO_PARAGRAPH_BORDERS;
  for (const node of paragraphPropertyNodes) {
    if (!node || node.kind === 'textValue') continue;
    const pBdr = childNamed(node, 'pBdr');
    if (!pBdr) continue;
    borders = bordersOfElement(pBdr);
  }
  return borders;
}

/**
 * Visual stroke thickness layout publishes for one edge (points).
 *
 * Compound `ST_Border` values (`double`, …) use the shared inflated band so a thin
 * `w:sz="3"` double still occupies a visible double-line box — matching table borders.
 */
export function paragraphBorderStrokeWidthPt(edge: ParagraphBorderEdge): number {
  return borderStrokeWidthPt(edge.val, edge.widthPt);
}

/**
 * Extent one border edge occupies away from the text it decorates: gap plus rule, in points.
 *
 * Vertically that is flow height — a top rule pushes the first line down, a bottom rule holds
 * the page open below the last one — so pagination has to see it. Horizontally it is
 * publish-only: Word draws left/right paragraph rules OUTSIDE the text column and never
 * re-breaks the lines, which is why adding a box to a paragraph in Word does not reflow it.
 */
export function paragraphBorderExtentPt(edge: ParagraphBorderEdge | undefined): number {
  if (!edge) return 0;
  return edge.spacePt + paragraphBorderStrokeWidthPt(edge);
}

/** Vertical extent a bottom border adds below the last line (gap + rule). */
export function bottomBorderExtentPt(edge: ParagraphBorderEdge | undefined): number {
  return paragraphBorderExtentPt(edge);
}

/**
 * Identity of a paragraph's border set, for the `w:between` group rule.
 *
 * Word treats consecutive paragraphs whose border settings are IDENTICAL as ONE bordered
 * block: the top rule draws above the first, the bottom rule below the last, and each
 * interior boundary gets `w:between` or nothing (§17.3.1.24). That is why applying a box to
 * three selected paragraphs in Word draws one box and not three.
 *
 * Empty string means "no borders", which never groups with anything.
 */
export function paragraphBordersFingerprint(borders: ParagraphBorders): string {
  const parts: string[] = [];
  for (const side of PARAGRAPH_BORDER_SIDES) {
    const edge = borders[side];
    if (!edge) continue;
    parts.push(
      `${side}:${edge.val},${edge.color ?? 'auto'},${edge.widthPt},${edge.spacePt},${edge.shadow ? 1 : 0}`
    );
  }
  return parts.join('|');
}

/**
 * Gap to insert before a paragraph once the previous paragraph's `after` is already in the
 * flow cursor — Word takes the larger of the two rather than summing them.
 */
export function collapsedSpaceBefore(before: number, previousAfter: number): number {
  return Math.max(before, previousAfter) - previousAfter;
}

/**
 * Applied before-spacing for placement (Word 2013+ / compat mode 15).
 *
 * Adjacent before/after still collapse to the larger gap, but before is dropped entirely when
 * the paragraph begins at the top of a page mid-section. The first paragraph of a document or
 * section retains before. Callers publish this applied value on the fragment so shading, borders,
 * selection, and paint share one geometry.
 */
export function appliedSpaceBefore(
  before: number,
  previousAfter: number,
  atTopOfPage: boolean,
  firstParagraphOfSection: boolean
): number {
  if (atTopOfPage && !firstParagraphOfSection) return 0;
  return collapsedSpaceBefore(before, previousAfter);
}

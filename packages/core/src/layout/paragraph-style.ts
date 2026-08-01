// Resolved paragraph spacing and borders for semantic layout (task 7.3).
//
// Twips and eighth-points leave here as POINTS. Layout places from these numbers; paint
// only draws them. Unrecognised or hostile values are dropped or clamped rather than
// guessed — a wrong before-spacing moves every subsequent page break.

import type { OoxmlElement, OoxmlNode, OoxmlProperty } from '@docx-editor.dev/core-contract/store';

/** Whether a paragraph must start a new page (`w:pageBreakBefore`). */
export function paragraphBreaksBefore(props: readonly OoxmlProperty[]): boolean {
  return props.some(
    (property) =>
      property.localName === 'pageBreakBefore' &&
      property.attributes?.val !== '0' &&
      property.attributes?.val !== 'false'
  );
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

export interface ParagraphSpacing {
  /** `w:spacing/@before`, in points. */
  readonly before: number;
  /** `w:spacing/@after`, in points. */
  readonly after: number;
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

export interface ParagraphBorderEdge {
  /** Authored `ST_Border` value (`single`, `dashed`, …). */
  readonly val: string;
  /** RRGGBB, or null when auto/missing (paint defaults to black). */
  readonly color: string | null;
  /** Border thickness in points (`w:sz` is eighths of a point). */
  readonly widthPt: number;
  /** Gap from text to the rule, in points (`w:space`). */
  readonly spacePt: number;
}

export interface ParagraphBorders {
  readonly bottom?: ParagraphBorderEdge;
}

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

function twipsToPoints(raw: string | undefined): number {
  const twips = integer(raw, true);
  if (twips === null) return 0;
  return clampNonNegative(twips / 20, MAX_PARAGRAPH_SPACING_PT);
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
 * Resolve `w:spacing` before/after from flat paragraph properties.
 *
 * Line spacing (`w:line` / `w:lineRule`) is a separate concern — it changes measured line
 * height, not the gap between paragraphs — and is not resolved here.
 */
export function paragraphSpacing(props: readonly OoxmlProperty[]): ParagraphSpacing {
  let before = 0;
  let after = 0;
  for (const property of props) {
    if (property.localName !== 'spacing') continue;
    // Merged PER ATTRIBUTE, not per element. `w:spacing` is one element carrying
    // independent attributes, and a later entry in the cascade overrides only what it
    // actually states: a style that sets `w:before` alone must not erase the `w:after`
    // that `w:docDefaults` set, which is exactly the shape Word's own Heading styles have.
    const authoredBefore = property.attributes?.before;
    const authoredAfter = property.attributes?.after;
    if (authoredBefore !== undefined) before = twipsToPoints(authoredBefore);
    if (authoredAfter !== undefined) after = twipsToPoints(authoredAfter);
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
 * Extra leading goes ABOVE the text — the baseline moves down by the whole delta — which
 * is what Word does for `auto` and `atLeast`. An `exact` box smaller than the glyphs keeps
 * the baseline inside the box so the clipped text still sits on it.
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
  if (delta >= 0) return { height, baseline: naturalBaseline + delta };
  return { height, baseline: Math.max(0, Math.min(naturalBaseline, height)) };
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
    value = raw !== '0' && raw !== 'false' && raw !== 'off';
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

  return {
    val,
    color: hexColor(attributeValue(node, 'color')),
    widthPt,
    spacePt,
  };
}

/**
 * Resolve `w:pBdr` from the paragraph-properties node.
 *
 * Nested — `bottom` is a child of `pBdr`, not an attribute — so this reads the typed tree
 * rather than the flattened `OoxmlProperty[]` bag `propertiesOf` builds for leaf props.
 * Bottom is the accepted edge for this slice; other edges remain unread.
 */
export function paragraphBorders(pPr: OoxmlNode | undefined): ParagraphBorders {
  if (!pPr || pPr.kind === 'textValue') return {};
  const pBdr = childNamed(pPr, 'pBdr');
  if (!pBdr) return {};
  const bottom = resolveBorderEdge(childNamed(pBdr, 'bottom'));
  return bottom ? { bottom } : {};
}

/** Vertical extent a bottom border adds below the last line (gap + rule). */
export function bottomBorderExtentPt(edge: ParagraphBorderEdge | undefined): number {
  if (!edge) return 0;
  return edge.spacePt + edge.widthPt;
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

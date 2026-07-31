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
    before = twipsToPoints(property.attributes?.before);
    after = twipsToPoints(property.attributes?.after);
  }
  return { before, after };
}

function resolveBorderEdge(node: OoxmlElement | undefined): ParagraphBorderEdge | undefined {
  if (!node) return undefined;
  const val = attributeValue(node, 'val');
  if (!val || NO_BORDER.has(val)) return undefined;

  // `w:sz` is eighths of a point. Missing size yields a hairline so a border that declares
  // a style but no thickness still paints — matching Word's default of ½pt for bare edges.
  const eighths = integer(attributeValue(node, 'sz'));
  const widthPt =
    eighths === null
      ? 0.5
      : clampNonNegative(eighths / 8, MAX_BORDER_WIDTH_PT) || 0.5;

  const spaceRaw = integer(attributeValue(node, 'space'));
  const spacePt =
    spaceRaw === null ? 0 : clampNonNegative(spaceRaw, MAX_BORDER_SPACE_PT);

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

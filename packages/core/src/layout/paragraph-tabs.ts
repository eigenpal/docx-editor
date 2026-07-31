// OOXML paragraph tab stops for shared paragraph flow (body, cells, headers, footers).
//
// Positions are twips → points relative to the paragraph content origin (the left edge of
// the flow box / page content). Custom stops come from cascaded `w:pPr/w:tabs`; when no
// explicit stop lies past the cursor, a bounded default-tab interval advances as a left tab.
// Right/center/decimal stops size the tab glyph from the measured following segment so the
// segment's end/center/decimal lands on the stop — never a mere cursor jump.
//
// Hostile authored values are dropped or clamped; stop count is capped; nothing from the
// file is used as a loop bound or allocation size.

import type { OoxmlElement, OoxmlNode } from '@docx-editor.dev/core-contract/store';

/** Soft ceiling matching Word's practical custom-tab UI limit. */
export const MAX_TAB_STOPS = 64;

/**
 * Soft ceiling on a tab position (31_680 twips ≈ 22"), matching paragraph-spacing bounds so
 * a hostile stop cannot shove layout into pathological widths.
 */
export const MAX_TAB_POSITION_TWIPS = 31_680;

/** OOXML / Word default when `w:settings/w:defaultTabStop` is absent: 720 twips = 0.5". */
export const DEFAULT_TAB_INTERVAL_TWIPS = 720;

export const DEFAULT_TAB_INTERVAL_PT = DEFAULT_TAB_INTERVAL_TWIPS / 20;

export type TabAlignment = 'left' | 'center' | 'right' | 'decimal';

export interface TabStop {
  /** Position from the paragraph content origin, in points. */
  readonly positionPt: number;
  readonly alignment: TabAlignment;
}

export interface ResolvedTabStops {
  /** Custom stops sorted by ascending position. */
  readonly stops: readonly TabStop[];
  /** Default-tab interval in points (always positive and bounded). */
  readonly defaultIntervalPt: number;
}

export const EMPTY_TAB_STOPS: ResolvedTabStops = Object.freeze({
  stops: Object.freeze([]),
  defaultIntervalPt: DEFAULT_TAB_INTERVAL_PT,
});

const TAB_ALIGNMENTS = new Set<string>(['left', 'center', 'right', 'decimal']);

function isElement(node: OoxmlNode): node is OoxmlElement {
  return node.kind !== 'textValue';
}

function attributeValue(node: OoxmlElement, localName: string): string | undefined {
  return node.attributes.find((attribute) => attribute.localName === localName)?.value;
}

function childNamed(parent: OoxmlElement, localName: string): OoxmlElement | undefined {
  for (const child of parent.children) {
    if (isElement(child) && child.localName === localName) return child;
  }
  return undefined;
}

function integerTwips(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  // Up to 9 digits so oversized values reach the clamp; longer strings are garbage.
  if (!/^-?\d{1,9}$/.test(raw)) return null;
  return Number(raw);
}

function clampPositionTwips(twips: number): number | null {
  if (!Number.isFinite(twips)) return null;
  if (twips < 0) return null;
  return twips > MAX_TAB_POSITION_TWIPS ? MAX_TAB_POSITION_TWIPS : twips;
}

/**
 * Apply one `w:tabs` element onto a position→alignment map.
 *
 * `clear` removes a stop at that position; recognised alignments upsert. Unknown `val` and
 * non-stop kinds (`bar`, `num`, …) are ignored. At most `MAX_TAB_STOPS` survive.
 */
function applyTabsElement(
  byTwips: Map<number, TabAlignment>,
  tabs: OoxmlElement | undefined
): void {
  if (!tabs) return;
  // Cap the walk — never `tabs.children.length` as a bound for allocation.
  let seen = 0;
  for (const child of tabs.children) {
    if (seen >= MAX_TAB_STOPS * 2) break;
    seen += 1;
    if (!isElement(child) || child.localName !== 'tab') continue;
    const twips = clampPositionTwips(integerTwips(attributeValue(child, 'pos')) ?? NaN);
    if (twips === null) continue;
    const val = attributeValue(child, 'val') ?? 'left';
    if (val === 'clear') {
      byTwips.delete(twips);
      continue;
    }
    if (!TAB_ALIGNMENTS.has(val)) continue;
    if (byTwips.size >= MAX_TAB_STOPS && !byTwips.has(twips)) continue;
    byTwips.set(twips, val as TabAlignment);
  }
}

function mapToResolved(byTwips: Map<number, TabAlignment>): ResolvedTabStops {
  const ordered = [...byTwips.entries()].sort((a, b) => a[0] - b[0]);
  const stops: TabStop[] = [];
  for (let index = 0; index < ordered.length && index < MAX_TAB_STOPS; index += 1) {
    const [twips, alignment] = ordered[index]!;
    stops.push({ positionPt: twips / 20, alignment });
  }
  return {
    stops: Object.freeze(stops),
    defaultIntervalPt: DEFAULT_TAB_INTERVAL_PT,
  };
}

/**
 * Resolve tab stops from cascaded `w:pPr` nodes (docDefaults → style chain → direct).
 *
 * Each `w:tabs` merges with `clear` support; absence inherits. Leaders are ignored — they
 * are a paint concern, not a break geometry input.
 */
export function cascadedTabStops(
  paragraphPropertyNodes: readonly OoxmlNode[]
): ResolvedTabStops {
  const byTwips = new Map<number, TabAlignment>();
  for (const node of paragraphPropertyNodes) {
    if (!node || !isElement(node)) continue;
    applyTabsElement(byTwips, childNamed(node, 'tabs'));
  }
  return mapToResolved(byTwips);
}

/** Direct `w:pPr` only — used when no style cascade table is present. */
export function paragraphTabStops(pPr: OoxmlNode | undefined): ResolvedTabStops {
  if (!pPr || !isElement(pPr)) return EMPTY_TAB_STOPS;
  const byTwips = new Map<number, TabAlignment>();
  applyTabsElement(byTwips, childNamed(pPr, 'tabs'));
  return mapToResolved(byTwips);
}

export interface TabDestination {
  readonly positionPt: number;
  readonly alignment: TabAlignment;
}

/**
 * Next tab destination strictly past `currentX`, preferring custom stops then the default
 * interval. Destination is clamped to `rightEdge` so stops cannot escape the content box.
 */
export function nextTabDestination(
  tabs: ResolvedTabStops,
  currentX: number,
  rightEdge: number
): TabDestination {
  const edge = Math.max(currentX, rightEdge);
  for (const stop of tabs.stops) {
    if (stop.positionPt > currentX) {
      return {
        positionPt: Math.min(stop.positionPt, edge),
        alignment: stop.alignment,
      };
    }
  }
  const interval = tabs.defaultIntervalPt > 0 ? tabs.defaultIntervalPt : DEFAULT_TAB_INTERVAL_PT;
  let next = Math.ceil((currentX + 1e-9) / interval) * interval;
  if (next <= currentX) next += interval;
  return {
    positionPt: Math.min(next, edge),
    alignment: 'left',
  };
}

/**
 * Width of a tab glyph so the following segment lands on the destination.
 *
 * `segmentWidth` / `decimalOffset` are already measured in points. Decimal offset is the
 * advance from the segment start to the decimal point (0 when none — treated like right).
 */
export function tabAdvanceWidth(
  alignment: TabAlignment,
  currentX: number,
  destinationX: number,
  segmentWidth: number,
  decimalOffset: number
): number {
  let target = destinationX;
  switch (alignment) {
    case 'center':
      target = destinationX - segmentWidth / 2;
      break;
    case 'right':
      target = destinationX - segmentWidth;
      break;
    case 'decimal':
      target = destinationX - decimalOffset;
      break;
    default:
      // left: following text starts at the stop
      target = destinationX;
  }
  const advance = target - currentX;
  return advance > 0 ? advance : 0;
}

/**
 * Stable fingerprint for layout cache keys — nested `w:tabs` are not in flat `OoxmlProperty`
 * bags, so style-inherited stops must be named explicitly or breaks would collide.
 */
export function tabStopsFingerprint(tabs: ResolvedTabStops): string {
  const stops = tabs.stops
    .map((stop) => `${stop.alignment}@${Math.round(stop.positionPt * 1000)}`)
    .join(',');
  return `tabs(${stops}|d${Math.round(tabs.defaultIntervalPt * 1000)})`;
}

// Pure width accounting for the measured toolbar row.
//
// Collapsible groups are costed with the separator slot that precedes them on the bar:
// separator border-box width, inline margins, and flex gaps on both sides. That
// overstates the first group by one separator — the safe direction — but must not
// undercount margins or the bar clips before it collapses.
//
// Fixed groups and the More trigger never receive that separator allowance: More sits
// after flex content with margin-inline-start: auto, not after a rule.

/** Leading separator slot cost for one collapsible group (px). */
export function separatorLeadingCost(
  separatorWidth: number,
  marginInlineStart: number,
  marginInlineEnd: number,
  gap: number
): number {
  return separatorWidth + marginInlineStart + marginInlineEnd + gap * 2;
}

/** Total width charged for one collapsible group on the bar. */
export function collapsibleGroupCost(groupWidth: number, separatorLeading: number): number {
  return groupWidth + separatorLeading;
}

/** Flex gap charged after a fixed group or the More trigger. */
export function trailingGapCost(width: number, gap: number): number {
  return width + gap;
}

/** Read inline margins from computed style (px). */
export function readInlineMargins(style: CSSStyleDeclaration): {
  readonly start: number;
  readonly end: number;
} {
  const start = Number.parseFloat(style.marginInlineStart || style.marginLeft);
  const end = Number.parseFloat(style.marginInlineEnd || style.marginRight);
  return {
    start: Number.isFinite(start) ? start : 0,
    end: Number.isFinite(end) ? end : 0,
  };
}

function px(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Parse column gap from toolbar computed style. */
export function readColumnGap(style: CSSStyleDeclaration): number {
  return px(style.columnGap);
}

/** What {@link barRoomWidth} measures against, all in px. */
export interface BarRoomInput {
  /** The bar's current content width: its client width less its inline padding. */
  readonly own: number;
  /** The parent's content-box width. `0` or less means it is unknown. */
  readonly parentContent: number;
  /** Width the bar's siblings take on the same line, gaps included. */
  readonly siblings: number;
  /** The bar's inline margins, auto margins excluded. */
  readonly margins: number;
  /** The bar's inline padding, border, and scrollbar. */
  readonly chrome: number;
  /** The bar's resolved `max-width` as a border-box width, or null for none. */
  readonly maxWidth: number | null;
}

/**
 * The content width the bar CAN take, which is what decides what fits.
 *
 * A bar that fills its container can take exactly the box it has. A bar as wide as its
 * content (`width: max-content`, a floating pill) shrinks when a group leaves, so its own box
 * never shows the room outside it, and a collapsed group would never come back. The room is
 * the parent's content width, less the siblings on the same line and the bar's margins,
 * capped by the bar's `max-width`. It is never less than the box the bar already has.
 */
export function barRoomWidth(input: BarRoomInput): number {
  if (!(input.parentContent > 0)) return input.own;
  let outer = input.parentContent - input.siblings - input.margins;
  if (input.maxWidth !== null) outer = Math.min(outer, input.maxWidth);
  return Math.max(input.own, outer - input.chrome);
}

function outOfFlow(style: CSSStyleDeclaration): boolean {
  return style.position === 'absolute' || style.position === 'fixed' || style.display === 'none';
}

/** The width that siblings take beside the bar in a single-line flex row, gaps included. */
function readSiblingWidth(bar: HTMLElement, parentStyle: CSSStyleDeclaration): number {
  const row =
    parentStyle.display.includes('flex') &&
    !parentStyle.flexDirection.startsWith('column') &&
    !parentStyle.flexWrap.startsWith('wrap');
  if (!row || !bar.parentElement) return 0;
  let width = 0;
  let items = 0;
  for (const child of bar.parentElement.children) {
    if (!(child instanceof HTMLElement)) continue;
    const childStyle = getComputedStyle(child);
    if (outOfFlow(childStyle)) continue;
    items += 1;
    if (child === bar) continue;
    width += child.offsetWidth + px(childStyle.marginLeft) + px(childStyle.marginRight);
  }
  return width + Math.max(0, items - 1) * px(parentStyle.columnGap);
}

/** The bar's resolved `max-width` as a border-box width, or null for none. */
function readMaxWidth(
  style: CSSStyleDeclaration,
  parentContent: number,
  chrome: number
): number | null {
  const value = style.maxWidth.trim();
  let width: number;
  if (value.endsWith('%')) width = (Number.parseFloat(value) / 100) * parentContent;
  else if (value.endsWith('px')) width = Number.parseFloat(value);
  else return null;
  if (!Number.isFinite(width)) return null;
  return style.boxSizing === 'border-box' ? width : width + chrome;
}

/**
 * The bar's available content width: the room it can take, see {@link barRoomWidth}. A bar
 * that is positioned out of flow, or has no parent, measures its own box.
 */
export function readAvailableWidth(bar: HTMLElement, style: CSSStyleDeclaration): number {
  const padding = px(style.paddingLeft) + px(style.paddingRight);
  const own = bar.clientWidth - padding;
  const parent = bar.parentElement;
  if (!parent || outOfFlow(style)) return own;
  const parentStyle = getComputedStyle(parent);
  const parentContent =
    parent.clientWidth - px(parentStyle.paddingLeft) - px(parentStyle.paddingRight);
  const chrome = Math.max(0, bar.offsetWidth - bar.clientWidth) + padding;
  const left = px(style.marginLeft);
  const right = px(style.marginRight);
  // Auto margins that center the bar report the free space as margin. They are room the
  // bar can grow into, not room it gives up.
  const centered =
    left === right && left > 0 && left + right + bar.offsetWidth >= parentContent - 1;
  return barRoomWidth({
    own,
    parentContent,
    siblings: readSiblingWidth(bar, parentStyle),
    margins: centered ? 0 : left + right,
    chrome,
    maxWidth: readMaxWidth(style, parentContent, chrome),
  });
}

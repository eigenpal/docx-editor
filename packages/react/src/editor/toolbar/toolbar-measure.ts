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

/** The minimal Typed OM surface this file reads. */
type SpecifiedStyle = { get(property: string): unknown } | null;

/**
 * The element's specified (not used) values, through Typed OM. Null where the browser has no
 * `computedStyleMap`: the caller then keeps the bar's own measurement.
 */
function specifiedStyle(element: Element): SpecifiedStyle {
  const read = (element as { computedStyleMap?: () => SpecifiedStyle }).computedStyleMap;
  if (typeof read !== 'function') return null;
  try {
    return read.call(element);
  } catch {
    return null;
  }
}

/** The keyword a property specifies (`auto`, `max-content`), or null for a length. */
function keywordOf(style: SpecifiedStyle, property: string): string | null {
  const value = style?.get(property) as { value?: unknown } | undefined;
  return value && typeof value.value === 'string' ? value.value : null;
}

/** Widths that size an element to its content rather than to its container. */
const CONTENT_WIDTHS = new Set(['auto', 'max-content', 'fit-content', 'min-content']);

/** True for a single-line flex row. */
function isFlexRow(style: CSSStyleDeclaration): boolean {
  return (
    style.display.includes('flex') &&
    !style.flexDirection.startsWith('column') &&
    !style.flexWrap.startsWith('wrap')
  );
}

/** An inline margin as the room it takes: an `auto` margin takes none. */
function marginWidth(
  specified: SpecifiedStyle,
  style: CSSStyleDeclaration,
  side: 'left' | 'right'
) {
  if (keywordOf(specified, `margin-${side}`) === 'auto') return 0;
  return px(side === 'left' ? style.marginLeft : style.marginRight);
}

/** True when an element has something to show: a form control, child elements, or text. */
function hasContent(element: HTMLElement): boolean {
  if (/^(INPUT|TEXTAREA|SELECT|BUTTON|IMG|VIDEO|CANVAS|IFRAME)$/.test(element.tagName)) return true;
  return element.children.length > 0 || (element.textContent ?? '').trim().length > 0;
}

/**
 * The width that siblings take beside the bar in a single-line flex row, gaps included, or
 * null when it cannot be known.
 *
 * A sibling that grows (a `flex: 1` spacer) fills the free space, so its box is not what it
 * needs: an empty one counts by its flex basis instead. Auto margins are free space too. A
 * growing sibling WITH content and `min-width: auto` (a title field, a search box) needs at
 * least its content width, which this file cannot read, so the answer is null.
 */
function readSiblingWidth(bar: HTMLElement, parentStyle: CSSStyleDeclaration): number | null {
  if (!isFlexRow(parentStyle) || !bar.parentElement) return 0;
  let width = 0;
  let items = 0;
  for (const child of bar.parentElement.children) {
    if (!(child instanceof HTMLElement)) continue;
    const childStyle = getComputedStyle(child);
    if (outOfFlow(childStyle)) continue;
    items += 1;
    if (child === bar) continue;
    const specified = specifiedStyle(child);
    const grows = Number.parseFloat(childStyle.flexGrow) > 0;
    if (grows && hasContent(child)) {
      const minWidth = keywordOf(specified, 'min-width') ?? childStyle.minWidth.trim();
      if (minWidth === 'auto' || minWidth === '') return null;
    }
    const basis = childStyle.flexBasis.trim();
    const box = grows ? (basis.endsWith('px') ? px(basis) : 0) : child.offsetWidth;
    width +=
      box +
      marginWidth(specified, childStyle, 'left') +
      marginWidth(specified, childStyle, 'right');
  }
  return width + Math.max(0, items - 1) * px(parentStyle.columnGap);
}

/**
 * The bar's resolved `max-width` as a border-box width, null for `none`, or undefined for a
 * value this file cannot resolve (`calc()`, `min()`, a font-relative unit).
 */
function readMaxWidth(
  style: CSSStyleDeclaration,
  parentContent: number,
  chrome: number
): number | null | undefined {
  const value = style.maxWidth.trim();
  if (value === 'none' || value === '') return null;
  let width: number;
  if (/^-?[\d.]+%$/.test(value)) width = (Number.parseFloat(value) / 100) * parentContent;
  else if (/^-?[\d.]+px$/.test(value)) width = Number.parseFloat(value);
  else return undefined;
  if (!Number.isFinite(width)) return undefined;
  return style.boxSizing === 'border-box' ? width : width + chrome;
}

/**
 * The bar's available content width.
 *
 * The bar's own box, except for a CONTENT-SIZED bar (specified width `auto`, `max-content`,
 * `fit-content`, or `min-content`, and not growing as a flex item) in a layout this file
 * understands: a block-level bar in a `block` or `flow-root` parent, or an item of a
 * single-line flex row. That bar gets the room it can take, see {@link barRoomWidth}. A grid
 * cell, a table cell, an inline bar, a floated bar, an explicit width, an out-of-flow bar, a
 * `max-width` that does not resolve, a growing sibling with content, and a browser without
 * Typed OM all keep the bar's own box: the safe side, which collapses early rather than
 * overflowing the next column.
 *
 * The parent-based room only ever brings groups BACK. A bar whose content already overflows
 * its box measures its own box, so the fit collapses groups until the content fits.
 */
export function readAvailableWidth(bar: HTMLElement, style: CSSStyleDeclaration): number {
  const padding = px(style.paddingLeft) + px(style.paddingRight);
  const own = bar.clientWidth - padding;
  const parent = bar.parentElement;
  if (!parent || outOfFlow(style)) return own;
  if (bar.scrollWidth > bar.clientWidth + 1) return own;
  if ((style.cssFloat || style.getPropertyValue('float') || 'none') !== 'none') return own;
  const specified = specifiedStyle(bar);
  const width = keywordOf(specified, 'width');
  if (width === null || !CONTENT_WIDTHS.has(width)) return own;
  const parentStyle = getComputedStyle(parent);
  const flexItem = isFlexRow(parentStyle);
  const blockChild =
    (parentStyle.display === 'block' || parentStyle.display === 'flow-root') &&
    !style.display.startsWith('inline');
  if (!flexItem && !blockChild) return own;
  if (flexItem && Number.parseFloat(style.flexGrow) > 0) return own;
  const parentContent =
    parent.clientWidth - px(parentStyle.paddingLeft) - px(parentStyle.paddingRight);
  const chrome = Math.max(0, bar.offsetWidth - bar.clientWidth) + padding;
  const siblings = readSiblingWidth(bar, parentStyle);
  const maxWidth = readMaxWidth(style, parentContent, chrome);
  if (siblings === null || maxWidth === undefined) return own;
  return barRoomWidth({
    own,
    parentContent,
    siblings,
    margins: marginWidth(specified, style, 'left') + marginWidth(specified, style, 'right'),
    chrome,
    maxWidth,
  });
}

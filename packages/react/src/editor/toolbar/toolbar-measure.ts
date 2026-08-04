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

/** Content width inside toolbar horizontal padding. */
export function readAvailableWidth(bar: HTMLElement, style: CSSStyleDeclaration): number {
  return bar.clientWidth - px(style.paddingLeft) - px(style.paddingRight);
}

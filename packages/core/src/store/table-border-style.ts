/** Allowlisted OOXML table border line styles — store/layout authority. */
export const TABLE_BORDER_STYLES = [
  'single',
  'dashed',
  'dotted',
  'double',
  'triple',
  'thick',
] as const;

export type TableBorderStyle = (typeof TABLE_BORDER_STYLES)[number];

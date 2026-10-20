// Bounded readers for the row and cell properties a table structure reads.
import { readTwipsMeasure, type OoxmlElement } from '@docx-editor.dev/core/store';
import { shadingFillFromElement } from './ooxml-shading.ts';
import {
  MAX_TABLE_ROW_HEIGHT_PT,
  type TableRowHeight,
  type TableRowHeightRule,
} from './semantic-table.ts';
import { MAX_TABLE_COLUMNS } from './table-widths.ts';

function childNamed(node: OoxmlElement, localName: string): OoxmlElement | undefined {
  for (const child of node.children) {
    if (child.kind !== 'textValue' && child.localName === localName) return child;
  }
  return undefined;
}

function attributeValue(node: OoxmlElement, localName: string): string | undefined {
  return node.attributes.find((attribute) => attribute.localName === localName)?.value;
}

export function readGridSpan(cellProperties: OoxmlElement | undefined): number {
  const raw = cellProperties && childNamed(cellProperties, 'gridSpan');
  const value = raw && attributeValue(raw, 'val');
  if (!value || !/^\d{1,7}$/.test(value)) return 1;
  const span = Number(value);
  return Number.isInteger(span) && span > 1 ? Math.min(span, MAX_TABLE_COLUMNS) : 1;
}

/** `w:gridBefore` / `w:gridAfter` (17.4.14 / 17.4.13): grid columns the row leaves empty. */
export function readGridSkip(rowProperties: OoxmlElement | undefined, localName: string): number {
  const raw = rowProperties && childNamed(rowProperties, localName);
  const value = raw && attributeValue(raw, 'val');
  if (!value || !/^\d{1,7}$/.test(value)) return 0;
  const count = Number(value);
  return Number.isInteger(count) && count > 0 ? Math.min(count, MAX_TABLE_COLUMNS) : 0;
}

/** A cell's `w:vMerge` marker: absent, `restart`, or continue (explicit or bare). */
export function readVMerge(
  cellProperties: OoxmlElement | undefined
): 'none' | 'restart' | 'continue' {
  const vMerge = cellProperties && childNamed(cellProperties, 'vMerge');
  if (!vMerge) return 'none';
  return attributeValue(vMerge, 'val') === 'restart' ? 'restart' : 'continue';
}

export function readShading(cellProperties: OoxmlElement | undefined): string | undefined {
  return shadingFillFromElement(cellProperties && childNamed(cellProperties, 'shd'));
}

/**
 * A `w:trPr` toggle (`w:tblHeader`, `w:cantSplit`), absent meaning off.
 *
 * `off` is an off value (§17.17.4), like `0` and `false` — the `onOff` helper below already
 * accepts all three. Missing it here meant `<w:tblHeader w:val="off"/>` read as ON, and the
 * row repeated as a header on every page of a long table.
 */
export function readFlag(container: OoxmlElement | undefined, localName: string): boolean {
  const flag = container && childNamed(container, localName);
  if (!flag) return false;
  const value = attributeValue(flag, 'val');
  return value === undefined || (value !== '0' && value !== 'false' && value !== 'off');
}

const AUTO_ROW_HEIGHT: TableRowHeight = Object.freeze({ rule: 'auto' });

/**
 * Read `w:trHeight` (17.4.81). Hostile / unreadable values demote to auto so layout still
 * sizes from content rather than inventing geometry.
 */
export function readRowHeight(rowProperties: OoxmlElement | undefined): TableRowHeight {
  const node = rowProperties && childNamed(rowProperties, 'trHeight');
  if (!node) return AUTO_ROW_HEIGHT;
  const rawRule = attributeValue(node, 'hRule');
  const rule: TableRowHeightRule | undefined =
    rawRule === 'auto' || rawRule === 'exact' || rawRule === 'atLeast' ? rawRule : undefined;
  if (rule === 'auto') return AUTO_ROW_HEIGHT;

  const rawVal = attributeValue(node, 'val');
  const twips = readTwipsMeasure(rawVal);
  if (twips === null || twips <= 0) return AUTO_ROW_HEIGHT;
  const valuePt = Math.min(twips / 20, MAX_TABLE_ROW_HEIGHT_PT);
  if (!(valuePt > 0)) return AUTO_ROW_HEIGHT;

  // Omitted hRule + present val → atLeast (Word), not ECMA's auto-with-ignored-val.
  const effective: 'atLeast' | 'exact' = rule === 'exact' ? 'exact' : 'atLeast';
  return { rule: effective, valuePt };
}

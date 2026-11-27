// Which merged cell content the merged-text carry (`table-vmerge-fragment-carry.ts`) can
// continue on the next page with a cursor.
import type { OoxmlNode } from '@docx-editor.dev/core/store';
import { hardBreakKind } from '../store/package/hard-break.ts';
import type { SemanticTableCell } from './semantic-table.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
// Text, its properties, and inert markers. Notes, floating objects, page and column breaks, and
// unknown extensions stay on the existing path. Field instructions remain inert and use the native
// projection and its atomic source range.
const TEXT_NAMES = new Set([
  'p',
  'pPr',
  'r',
  'rPr',
  't',
  'spacing',
  'jc',
  'ind',
  'rFonts',
  'sz',
  'szCs',
  'lang',
  'b',
  'bCs',
  'i',
  'iCs',
  'u',
  'color',
  'highlight',
  'shd',
  'vertAlign',
  'kern',
  'position',
  'w',
  'fitText',
  'caps',
  'smallCaps',
  'strike',
  'dstrike',
  'vanish',
  'noProof',
  'rtl',
  'cs',
  'pStyle',
  'rStyle',
  'contextualSpacing',
  'widowControl',
  'fldChar',
  'instrText',
  'fldSimple',
  'lastRenderedPageBreak',
  'proofErr',
  'bookmarkStart',
  'bookmarkEnd',
  'tab',
  'tabs',
  'numPr',
  'numId',
  'ilvl',
  'keepNext',
  'keepLines',
  'ins',
  'del',
  'delText',
  'hyperlink',
]);

/**
 * Whether a merged cell's content flows as lines and blocks that a cursor can continue on the
 * next page. `inFlow` also admits content that sits in the line or block flow (`inFlowBlock`).
 * Merges over rows that can grow admit only text, because the older path sizes their rows.
 * `budget` bounds the nodes visited across every head of one table.
 */
export function flowsAcrossPages(
  cell: SemanticTableCell,
  budget: { remaining: number },
  inFlow: boolean
): boolean {
  if (cell.textDirection !== 'horizontal') return false;
  const pending: OoxmlNode[] = [...cell.blocks];
  while (pending.length > 0) {
    if (--budget.remaining < 0) return false;
    const node = pending.pop()!;
    if (node.kind === 'textValue') continue;
    if (!('localName' in node) || node.namespaceUri !== W) return false;
    if (inFlow && inFlowBlock(node, budget)) continue;
    if (!TEXT_NAMES.has(node.localName)) return false;
    for (const child of node.children) pending.push(child);
  }
  return true;
}

const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';

/**
 * Content whose place is in the line or block flow:
 *
 * - A line break: `w:br` (`CT_Br`, §17.3.3.1) that is not a page or column break (`ST_BrType`,
 *   §17.18.4), and a carriage return `w:cr` (`CT_Empty`, §17.3.3.4). Layout places a break of
 *   a type it does not model as a line break, so this check does too (`hardBreakKind`).
 * - An inline drawing: `w:drawing` (`CT_Drawing`, §17.3.3.9) that holds only `wp:inline`
 *   (`CT_Inline`, §20.4.2.8) and no text box.
 * - A nested table, `w:tbl` (`CT_Tbl`, §17.4.37), that splits inside the merged cell: no
 *   floating positioning (`w:tblpPr`, `CT_TblPPr`, §17.4.57), no repeated header row
 *   (`w:tblHeader`, `CT_OnOff`, §17.4.49), which keeps a nested table whole, and no notes or
 *   floating objects (`OUT_OF_FLOW`).
 */
function inFlowBlock(
  node: Extract<OoxmlNode, { localName: string }>,
  budget: { remaining: number }
): boolean {
  switch (node.localName) {
    case 'br':
      return lineBreak(node);
    case 'cr':
      return true;
    case 'drawing':
      return (
        node.children.length > 0 &&
        node.children.every(
          (child) =>
            'localName' in child && child.namespaceUri === WP && child.localName === 'inline'
        ) &&
        !holdsOutOfFlow(node, budget)
      );
    case 'tbl':
      return !holdsOutOfFlow(node, budget);
    default:
      return false;
  }
}

/** A `w:br` that breaks the line, not the page or column. */
function lineBreak(node: Extract<OoxmlNode, { localName: string }>): boolean {
  if (node.kind === 'hardBreak') {
    const kind = hardBreakKind(node);
    return kind !== 'page' && kind !== 'column';
  }
  const type = node.attributes.find(
    (attribute) => attribute.localName === 'type' && attribute.namespaceUri === W
  );
  return type?.value !== 'page' && type?.value !== 'column';
}

/**
 * Content that leaves the cell's flow or keeps a nested table whole: note references
 * (`w:footnoteReference` §17.11.14, `w:endnoteReference` §17.11.7, `CT_FtnEdnRef`), floating
 * drawings (`wp:anchor`, `CT_Anchor`, §20.4.2.3), embedded objects (`w:object`, `CT_Object`,
 * §17.3.3.19), legacy VML objects (`w:pict`, ECMA-376 Part 4 §14.3.2.2), text boxes
 * (`w:txbxContent`, `CT_TxbxContent`, §20.4.2.38), text frames (`w:framePr`, `CT_FramePr`,
 * §17.3.1.11), floating tables (`w:tblpPr`, `CT_TblPPr`, §17.4.57), and repeated header rows
 * (`w:tblHeader`, `CT_OnOff`, §17.4.49).
 *
 * Other nested table content needs no further check here: the carried head cell lays out and
 * splits a nested table through the same nested table layout as a cell of an ordinary row.
 */
const OUT_OF_FLOW = new Set([
  'footnoteReference',
  'endnoteReference',
  'anchor',
  'pict',
  'object',
  'txbxContent',
  'framePr',
  'tblpPr',
  'tblHeader',
]);

/** Whether `root` holds content that leaves the flow, or more than `budget` allows to check. */
function holdsOutOfFlow(root: OoxmlNode, budget: { remaining: number }): boolean {
  const pending: OoxmlNode[] = [...('children' in root ? root.children : [])];
  while (pending.length > 0) {
    if (--budget.remaining < 0) return true;
    const node = pending.pop()!;
    if (!('localName' in node)) continue;
    if (OUT_OF_FLOW.has(node.localName)) return true;
    if (node.namespaceUri === W && node.localName === 'br' && !lineBreak(node)) return true;
    for (const child of node.children) pending.push(child);
  }
  return false;
}

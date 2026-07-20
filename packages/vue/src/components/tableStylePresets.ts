/**
 * Built-in table style presets (shared between TableStyleGallery and
 * InsertTableDialog). Mirrors the React BUILTIN_STYLES list in
 * packages/react/src/components/ui/TableStyleGallery.tsx so both adapters
 * apply the same styles via the core `applyTableStyle` command.
 */
import type { CSSProperties } from 'vue';

export interface TableStyleBorder {
  style: string;
  size?: number;
  color?: { rgb: string };
}

export interface TableStylePreset {
  id: string;
  name: string;
  /** Table-level borders */
  tableBorders?: {
    top?: TableStyleBorder;
    bottom?: TableStyleBorder;
    left?: TableStyleBorder;
    right?: TableStyleBorder;
    insideH?: TableStyleBorder;
    insideV?: TableStyleBorder;
  };
  /** Conditional formatting per cell position */
  conditionals?: Record<
    string,
    {
      backgroundColor?: string;
      borders?: {
        top?: TableStyleBorder | null;
        bottom?: TableStyleBorder | null;
        left?: TableStyleBorder | null;
        right?: TableStyleBorder | null;
      };
      bold?: boolean;
      color?: string;
    }
  >;
  /** Which conditional formatting is active by default */
  look?: {
    firstRow?: boolean;
    lastRow?: boolean;
    firstCol?: boolean;
    lastCol?: boolean;
    noHBand?: boolean;
    noVBand?: boolean;
  };
}

const border1 = (rgb: string): TableStyleBorder => ({ style: 'single', size: 4, color: { rgb } });

export const BUILTIN_TABLE_STYLES: TableStylePreset[] = [
  {
    id: 'TableNormal',
    name: 'Normal Table',
    look: { firstRow: false, lastRow: false, noHBand: true, noVBand: true },
  },
  {
    id: 'TableGrid',
    name: 'Table Grid',
    tableBorders: {
      top: border1('000000'),
      bottom: border1('000000'),
      left: border1('000000'),
      right: border1('000000'),
      insideH: border1('000000'),
      insideV: border1('000000'),
    },
    look: { firstRow: false, lastRow: false, noHBand: true, noVBand: true },
  },
  {
    id: 'TableGridLight',
    name: 'Grid Table Light',
    tableBorders: {
      top: border1('BFBFBF'),
      bottom: border1('BFBFBF'),
      left: border1('BFBFBF'),
      right: border1('BFBFBF'),
      insideH: border1('BFBFBF'),
      insideV: border1('BFBFBF'),
    },
    look: { firstRow: true, lastRow: false, noHBand: true, noVBand: true },
    conditionals: {
      firstRow: { bold: true, borders: { bottom: border1('000000') } },
    },
  },
  {
    id: 'PlainTable1',
    name: 'Plain Table 1',
    tableBorders: {
      top: border1('BFBFBF'),
      bottom: border1('BFBFBF'),
      insideH: border1('BFBFBF'),
    },
    look: { firstRow: true, lastRow: false, noHBand: true, noVBand: true },
    conditionals: {
      firstRow: { bold: true },
    },
  },
  {
    id: 'PlainTable2',
    name: 'Plain Table 2',
    look: { firstRow: true, lastRow: false, noHBand: false, noVBand: true },
    conditionals: {
      firstRow: { bold: true, borders: { bottom: border1('7F7F7F') } },
      band1Horz: { backgroundColor: '#F2F2F2' },
    },
  },
  {
    id: 'PlainTable3',
    name: 'Plain Table 3',
    look: { firstRow: true, lastRow: false, noHBand: false, noVBand: true },
    conditionals: {
      firstRow: { bold: true, color: '#FFFFFF', backgroundColor: '#A5A5A5' },
      band1Horz: { backgroundColor: '#E7E7E7' },
    },
  },
  {
    id: 'PlainTable4',
    name: 'Plain Table 4',
    look: { firstRow: true, lastRow: false, noHBand: false, noVBand: true },
    conditionals: {
      firstRow: { bold: true, color: '#FFFFFF', backgroundColor: '#000000' },
      band1Horz: { backgroundColor: '#F2F2F2' },
    },
  },
  {
    id: 'GridTable1Light-Accent1',
    name: 'Grid Table 1 Light',
    tableBorders: {
      top: border1('B4C6E7'),
      bottom: border1('B4C6E7'),
      left: border1('B4C6E7'),
      right: border1('B4C6E7'),
      insideH: border1('B4C6E7'),
      insideV: border1('B4C6E7'),
    },
    look: { firstRow: true, lastRow: false, noHBand: true, noVBand: true },
    conditionals: {
      firstRow: { bold: true, borders: { bottom: border1('4472C4') } },
    },
  },
  {
    id: 'GridTable4-Accent1',
    name: 'Grid Table 4 Accent 1',
    tableBorders: {
      top: border1('4472C4'),
      bottom: border1('4472C4'),
      left: border1('4472C4'),
      right: border1('4472C4'),
      insideH: border1('4472C4'),
      insideV: border1('4472C4'),
    },
    look: { firstRow: true, lastRow: false, noHBand: false, noVBand: true },
    conditionals: {
      firstRow: { bold: true, color: '#FFFFFF', backgroundColor: '#4472C4' },
      band1Horz: { backgroundColor: '#D6E4F0' },
    },
  },
  {
    id: 'GridTable5Dark-Accent1',
    name: 'Grid Table 5 Dark',
    tableBorders: {
      top: border1('FFFFFF'),
      bottom: border1('FFFFFF'),
      left: border1('FFFFFF'),
      right: border1('FFFFFF'),
      insideH: border1('FFFFFF'),
      insideV: border1('FFFFFF'),
    },
    look: { firstRow: true, lastRow: false, noHBand: false, noVBand: true },
    conditionals: {
      firstRow: { bold: true, color: '#FFFFFF', backgroundColor: '#4472C4' },
      band1Horz: { backgroundColor: '#D6E4F0' },
      band2Horz: { backgroundColor: '#B4C6E7' },
    },
  },
  {
    id: 'ListTable3-Accent2',
    name: 'List Table 3 Accent 2',
    tableBorders: {
      top: border1('ED7D31'),
      bottom: border1('ED7D31'),
    },
    look: { firstRow: true, lastRow: false, noHBand: false, noVBand: true },
    conditionals: {
      firstRow: { bold: true, color: '#FFFFFF', backgroundColor: '#ED7D31' },
      band1Horz: { backgroundColor: '#FBE4D5' },
    },
  },
  {
    id: 'ListTable4-Accent3',
    name: 'List Table 4 Accent 3',
    tableBorders: {
      top: border1('A5A5A5'),
      bottom: border1('A5A5A5'),
      insideH: border1('A5A5A5'),
    },
    look: { firstRow: true, lastRow: false, noHBand: false, noVBand: true },
    conditionals: {
      firstRow: { bold: true, color: '#FFFFFF', backgroundColor: '#A5A5A5' },
      band1Horz: { backgroundColor: '#EDEDED' },
    },
  },
  {
    id: 'GridTable4-Accent5',
    name: 'Grid Table 4 Accent 5',
    tableBorders: {
      top: border1('5B9BD5'),
      bottom: border1('5B9BD5'),
      left: border1('5B9BD5'),
      right: border1('5B9BD5'),
      insideH: border1('5B9BD5'),
      insideV: border1('5B9BD5'),
    },
    look: { firstRow: true, lastRow: false, noHBand: false, noVBand: true },
    conditionals: {
      firstRow: { bold: true, color: '#FFFFFF', backgroundColor: '#5B9BD5' },
      band1Horz: { backgroundColor: '#DEEAF6' },
    },
  },
  {
    id: 'GridTable4-Accent6',
    name: 'Grid Table 4 Accent 6',
    tableBorders: {
      top: border1('70AD47'),
      bottom: border1('70AD47'),
      left: border1('70AD47'),
      right: border1('70AD47'),
      insideH: border1('70AD47'),
      insideV: border1('70AD47'),
    },
    look: { firstRow: true, lastRow: false, noHBand: false, noVBand: true },
    conditionals: {
      firstRow: { bold: true, color: '#FFFFFF', backgroundColor: '#70AD47' },
      band1Horz: { backgroundColor: '#E2EFDA' },
    },
  },
];

/** Get a built-in table style preset by ID. */
export function getBuiltinTableStyle(styleId: string): TableStylePreset | undefined {
  return BUILTIN_TABLE_STYLES.find((s) => s.id === styleId);
}

/** Map from built-in style ID to en.json translation key under `table.styles.*`. */
export const TABLE_STYLE_NAME_KEYS: Record<string, string> = {
  TableNormal: 'table.styles.normalTable',
  TableGrid: 'table.styles.tableGrid',
  TableGridLight: 'table.styles.gridTableLight',
  PlainTable1: 'table.styles.plainTable1',
  PlainTable2: 'table.styles.plainTable2',
  PlainTable3: 'table.styles.plainTable3',
  PlainTable4: 'table.styles.plainTable4',
  'GridTable1Light-Accent1': 'table.styles.gridTable1Light',
  'GridTable4-Accent1': 'table.styles.gridTable4Accent1',
  'GridTable5Dark-Accent1': 'table.styles.gridTable5Dark',
  'ListTable3-Accent2': 'table.styles.listTable3Accent2',
  'ListTable4-Accent3': 'table.styles.listTable4Accent3',
  'GridTable4-Accent5': 'table.styles.gridTable4Accent5',
  'GridTable4-Accent6': 'table.styles.gridTable4Accent6',
};

const PREVIEW_ROWS = 4;
const PREVIEW_COLS = 3;

function borderToCSS(border?: TableStyleBorder | null): string {
  if (!border || border.style === 'none') return 'none';
  const w = border.size ? Math.max(1, Math.round(border.size / 8)) : 1;
  const c = border.color?.rgb ? `#${border.color.rgb}` : '#000';
  return `${w}px solid ${c}`;
}

/**
 * Build the per-cell inline styles for a small preview grid of the given
 * preset. Shared by TableStyleGallery and InsertTableDialog so the preview
 * rendering stays in one place.
 */
export function getPreviewCells(
  preset: TableStylePreset,
  rows = PREVIEW_ROWS,
  cols = PREVIEW_COLS
): CSSProperties[] {
  const look = preset.look ?? {};
  const conds = preset.conditionals ?? {};
  const tb = preset.tableBorders;
  const cells: CSSProperties[] = [];
  let dataRowIdx = 0;

  for (let r = 0; r < rows; r++) {
    const isFirstRow = r === 0 && !!look.firstRow;
    const isLastRow = r === rows - 1 && !!look.lastRow;
    const bandingOn = look.noHBand !== true;
    let condType: string | undefined;

    if (isFirstRow) {
      condType = 'firstRow';
    } else if (isLastRow) {
      condType = 'lastRow';
    } else if (bandingOn) {
      condType = dataRowIdx % 2 === 0 ? 'band1Horz' : 'band2Horz';
      dataRowIdx++;
    } else {
      dataRowIdx++;
    }

    for (let c = 0; c < cols; c++) {
      let cellCond = condType;
      const isFirstCol = c === 0 && !!look.firstCol;
      const isLastCol = c === cols - 1 && !!look.lastCol;
      if (isFirstRow && isFirstCol && conds['nwCell']) cellCond = 'nwCell';
      else if (isFirstRow && isLastCol && conds['neCell']) cellCond = 'neCell';
      else if (isLastRow && isFirstCol && conds['swCell']) cellCond = 'swCell';
      else if (isLastRow && isLastCol && conds['seCell']) cellCond = 'seCell';
      else if (isFirstCol) cellCond = 'firstCol';
      else if (isLastCol) cellCond = 'lastCol';

      const cond = cellCond ? conds[cellCond] : undefined;
      const condBorders = cond?.borders;

      const style: CSSProperties = {
        width: '20px',
        height: '10px',
        boxSizing: 'border-box',
        backgroundColor: cond?.backgroundColor ?? 'transparent',
        borderTop:
          condBorders?.top !== undefined
            ? borderToCSS(condBorders.top)
            : r > 0
              ? borderToCSS(tb?.insideH ?? tb?.top)
              : borderToCSS(tb?.top),
        borderBottom:
          condBorders?.bottom !== undefined
            ? borderToCSS(condBorders.bottom)
            : r < rows - 1
              ? borderToCSS(tb?.insideH ?? tb?.bottom)
              : borderToCSS(tb?.bottom),
        borderLeft:
          condBorders?.left !== undefined
            ? borderToCSS(condBorders.left)
            : c > 0
              ? borderToCSS(tb?.insideV ?? tb?.left)
              : borderToCSS(tb?.left),
        borderRight:
          condBorders?.right !== undefined
            ? borderToCSS(condBorders.right)
            : c < cols - 1
              ? borderToCSS(tb?.insideV ?? tb?.right)
              : borderToCSS(tb?.right),
      };
      cells.push(style);
    }
  }
  return cells;
}

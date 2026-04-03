<template>
  <div class="tsg">
    <div class="tsg__grid">
      <button
        v-for="preset in BUILTIN_STYLES"
        :key="preset.id"
        :class="['tsg__item', { 'tsg__item--selected': currentStyleId === preset.id }]"
        :title="preset.name"
        @mousedown.prevent="$emit('apply', preset.id)"
      >
        <div class="tsg__preview">
          <div
            v-for="(cell, idx) in getPreviewCells(preset)"
            :key="idx"
            class="tsg__cell"
            :style="cell"
          />
        </div>
        <span class="tsg__name">{{ preset.name }}</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { CSSProperties } from 'vue';

interface TableStylePreset {
  id: string;
  name: string;
  tableBorders?: Record<string, { style: string; size?: number; color?: { rgb: string } } | undefined>;
  conditionals?: Record<string, { backgroundColor?: string; bold?: boolean; color?: string; borders?: Record<string, { style: string; size?: number; color?: { rgb: string } } | null | undefined> }>;
  look?: { firstRow?: boolean; lastRow?: boolean; firstCol?: boolean; lastCol?: boolean; noHBand?: boolean; noVBand?: boolean };
}

defineProps<{
  currentStyleId?: string | null;
}>();

defineEmits<{
  (e: 'apply', styleId: string): void;
}>();

const border1 = (rgb: string) => ({ style: 'single' as const, size: 4, color: { rgb } });

const BUILTIN_STYLES: TableStylePreset[] = [
  { id: 'TableNormal', name: 'Normal Table', look: { firstRow: false, noHBand: true, noVBand: true } },
  { id: 'TableGrid', name: 'Table Grid', tableBorders: { top: border1('000000'), bottom: border1('000000'), left: border1('000000'), right: border1('000000'), insideH: border1('000000'), insideV: border1('000000') }, look: { firstRow: false, noHBand: true, noVBand: true } },
  { id: 'TableGridLight', name: 'Grid Table Light', tableBorders: { top: border1('BFBFBF'), bottom: border1('BFBFBF'), left: border1('BFBFBF'), right: border1('BFBFBF'), insideH: border1('BFBFBF'), insideV: border1('BFBFBF') }, look: { firstRow: true, noHBand: true }, conditionals: { firstRow: { bold: true, borders: { bottom: border1('000000') } } } },
  { id: 'PlainTable1', name: 'Plain Table 1', tableBorders: { top: border1('BFBFBF'), bottom: border1('BFBFBF'), insideH: border1('BFBFBF') }, look: { firstRow: true, noHBand: true }, conditionals: { firstRow: { bold: true } } },
  { id: 'PlainTable2', name: 'Plain Table 2', look: { firstRow: true, noHBand: false }, conditionals: { firstRow: { bold: true, borders: { bottom: border1('7F7F7F') } }, band1Horz: { backgroundColor: '#F2F2F2' } } },
  { id: 'PlainTable3', name: 'Plain Table 3', look: { firstRow: true, noHBand: false }, conditionals: { firstRow: { bold: true, color: '#FFFFFF', backgroundColor: '#A5A5A5' }, band1Horz: { backgroundColor: '#E7E7E7' } } },
  { id: 'PlainTable4', name: 'Plain Table 4', look: { firstRow: true, noHBand: false }, conditionals: { firstRow: { bold: true, color: '#FFFFFF', backgroundColor: '#000000' }, band1Horz: { backgroundColor: '#F2F2F2' } } },
  { id: 'GridTable1Light-Accent1', name: 'Grid Table 1 Light', tableBorders: { top: border1('B4C6E7'), bottom: border1('B4C6E7'), left: border1('B4C6E7'), right: border1('B4C6E7'), insideH: border1('B4C6E7'), insideV: border1('B4C6E7') }, look: { firstRow: true, noHBand: true }, conditionals: { firstRow: { bold: true, borders: { bottom: border1('4472C4') } } } },
  { id: 'GridTable4-Accent1', name: 'Grid Table 4 Blue', tableBorders: { top: border1('4472C4'), bottom: border1('4472C4'), left: border1('4472C4'), right: border1('4472C4'), insideH: border1('4472C4'), insideV: border1('4472C4') }, look: { firstRow: true, noHBand: false }, conditionals: { firstRow: { bold: true, color: '#FFFFFF', backgroundColor: '#4472C4' }, band1Horz: { backgroundColor: '#D6E4F0' } } },
  { id: 'GridTable5Dark-Accent1', name: 'Grid Table 5 Dark', tableBorders: { top: border1('FFFFFF'), bottom: border1('FFFFFF'), left: border1('FFFFFF'), right: border1('FFFFFF'), insideH: border1('FFFFFF'), insideV: border1('FFFFFF') }, look: { firstRow: true, noHBand: false }, conditionals: { firstRow: { bold: true, color: '#FFFFFF', backgroundColor: '#4472C4' }, band1Horz: { backgroundColor: '#D6E4F0' }, band2Horz: { backgroundColor: '#B4C6E7' } } },
  { id: 'ListTable3-Accent2', name: 'List Table 3 Orange', tableBorders: { top: border1('ED7D31'), bottom: border1('ED7D31') }, look: { firstRow: true, noHBand: false }, conditionals: { firstRow: { bold: true, color: '#FFFFFF', backgroundColor: '#ED7D31' }, band1Horz: { backgroundColor: '#FBE4D5' } } },
  { id: 'GridTable4-Accent5', name: 'Grid Table 4 Teal', tableBorders: { top: border1('5B9BD5'), bottom: border1('5B9BD5'), left: border1('5B9BD5'), right: border1('5B9BD5'), insideH: border1('5B9BD5'), insideV: border1('5B9BD5') }, look: { firstRow: true, noHBand: false }, conditionals: { firstRow: { bold: true, color: '#FFFFFF', backgroundColor: '#5B9BD5' }, band1Horz: { backgroundColor: '#DEEAF6' } } },
  { id: 'GridTable4-Accent6', name: 'Grid Table 4 Green', tableBorders: { top: border1('70AD47'), bottom: border1('70AD47'), left: border1('70AD47'), right: border1('70AD47'), insideH: border1('70AD47'), insideV: border1('70AD47') }, look: { firstRow: true, noHBand: false }, conditionals: { firstRow: { bold: true, color: '#FFFFFF', backgroundColor: '#70AD47' }, band1Horz: { backgroundColor: '#E2EFDA' } } },
  { id: 'ListTable4-Accent3', name: 'List Table 4 Gray', tableBorders: { top: border1('A5A5A5'), bottom: border1('A5A5A5'), insideH: border1('A5A5A5') }, look: { firstRow: true, noHBand: false }, conditionals: { firstRow: { bold: true, color: '#FFFFFF', backgroundColor: '#A5A5A5' }, band1Horz: { backgroundColor: '#EDEDED' } } },
];

const ROWS = 4;
const COLS = 3;

function borderToCSS(border?: { style: string; size?: number; color?: { rgb: string } } | null): string {
  if (!border || border.style === 'none') return 'none';
  const w = border.size ? Math.max(1, Math.round(border.size / 8)) : 1;
  const c = border.color?.rgb ? `#${border.color.rgb}` : '#000';
  return `${w}px solid ${c}`;
}

function getPreviewCells(preset: TableStylePreset): CSSProperties[] {
  const look = preset.look ?? {};
  const conds = preset.conditionals ?? {};
  const tb = preset.tableBorders;
  const cells: CSSProperties[] = [];
  let dataRowIdx = 0;

  for (let r = 0; r < ROWS; r++) {
    const isFirstRow = r === 0 && !!look.firstRow;
    const bandingOn = look.noHBand !== true;
    let condType: string | undefined;

    if (isFirstRow) condType = 'firstRow';
    else if (bandingOn) { condType = dataRowIdx % 2 === 0 ? 'band1Horz' : 'band2Horz'; dataRowIdx++; }
    else dataRowIdx++;

    for (let c = 0; c < COLS; c++) {
      const cond = condType ? conds[condType] : undefined;
      const condBorders = cond?.borders;

      const style: CSSProperties = {
        width: '20px',
        height: '10px',
        backgroundColor: cond?.backgroundColor ?? 'transparent',
        borderTop: r === 0 ? borderToCSS(tb?.top) : (condBorders?.top !== undefined ? borderToCSS(condBorders.top) : borderToCSS(tb?.insideH)),
        borderBottom: r === ROWS - 1 ? borderToCSS(tb?.bottom) : (condBorders?.bottom !== undefined ? borderToCSS(condBorders.bottom) : borderToCSS(tb?.insideH)),
        borderLeft: c === 0 ? borderToCSS(tb?.left) : borderToCSS(tb?.insideV),
        borderRight: c === COLS - 1 ? borderToCSS(tb?.right) : borderToCSS(tb?.insideV),
      };
      cells.push(style);
    }
  }
  return cells;
}
</script>

<style scoped>
.tsg__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(80px, 1fr));
  gap: 6px;
  padding: 8px;
}
.tsg__item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 6px;
  border: 2px solid transparent;
  border-radius: 6px;
  background: #fff;
  cursor: pointer;
}
.tsg__item:hover { border-color: #d1d5db; }
.tsg__item--selected { border-color: #3b82f6; background: #eff6ff; }
.tsg__preview {
  display: grid;
  grid-template-columns: repeat(3, 20px);
  grid-template-rows: repeat(4, 10px);
  gap: 0;
}
.tsg__cell { box-sizing: border-box; }
.tsg__name { font-size: 9px; color: #6b7280; text-align: center; line-height: 1.2; max-width: 72px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>

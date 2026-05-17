<!--
  Vue table-context toolbar — appears when the cursor is inside a
  table node. Picker order: TableBorderPicker → TableBorderColorPicker
  → TableBorderWidthPicker → TableCellFillPicker → TableMoreDropdown.
  Insert / merge / split actions live inside `TableMoreDropdown`.

  Each picker emits a UI-level value (preset name, hex color,
  "addRowAbove"-style action). This component routes those into the
  PM commands registered by `TableExtension`. A local `borderSpec`
  reactive holds the active style/width/color so subsequent preset
  clicks pick them up.
-->
<template>
  <template v-if="isInTable">
    <span class="divider" />
    <TableBorderPicker @change="onBorderPreset" />
    <TableBorderColorPicker :theme="theme ?? null" @change="onBorderColor" />
    <TableBorderWidthPicker @change="onBorderWidth" />
    <TableCellFillPicker :theme="theme ?? null" @change="onCellFill" />
    <TableMoreDropdown
      :can-split="canSplit"
      :can-merge="canMerge"
      :row-count="rowCount"
      :column-count="columnCount"
      :current-justification="currentJustification"
      @action="onMoreAction"
      @cell-margins="onCellMargins"
      @cell-text-direction="onCellTextDirection"
      @row-height="onRowHeight"
    />
  </template>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue';
import type { EditorView } from 'prosemirror-view';
import TableCellFillPicker from './TableCellFillPicker.vue';
import TableBorderPicker, { type TableBorderPreset } from './TableBorderPicker.vue';
import TableBorderColorPicker from './TableBorderColorPicker.vue';
import TableBorderWidthPicker from './TableBorderWidthPicker.vue';
import TableMoreDropdown, { type TableAction } from './TableMoreDropdown.vue';
import { getTableContext } from '@eigenpal/docx-editor-core/prosemirror/extensions/nodes/TableExtension';
import type { Theme } from '@eigenpal/docx-editor-core/types/document';

const props = defineProps<{
  view: EditorView | null;
  getCommands: () => Record<string, (...args: any[]) => any>;
  stateTick: number;
  /** Document theme — fed through to the border/fill color pickers. */
  theme?: Theme | null;
}>();

// Single source of truth for the table-context state the toolbar reads —
// recomputed on every editor transaction. `isInTable` and the "more"
// dropdown's gating/active state all derive from this one walk.
const tableCtx = computed(() => {
  void props.stateTick;
  const v = props.view;
  return v ? getTableContext(v.state) : null;
});

const isInTable = computed(() => !!tableCtx.value?.isInTable);

// "Split cell" needs the current cell to span more than one row/column —
// stricter than `getTableContext`'s `canSplitCell` ("just in a cell"),
// so it reads the cell node's colspan/rowspan directly.
const canSplit = computed(() => {
  void props.stateTick;
  const v = props.view;
  if (!v) return false;
  const { $from } = v.state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.node(depth).type.name === 'tableCell') {
      const cell = $from.node(depth);
      const colspan = (cell.attrs.colspan as number) || 1;
      const rowspan = (cell.attrs.rowspan as number) || 1;
      return colspan > 1 || rowspan > 1;
    }
  }
  return false;
});

const canMerge = computed(() => !!tableCtx.value?.hasMultiCellSelection);
const rowCount = computed(() => tableCtx.value?.rowCount ?? 0);
const columnCount = computed(() => tableCtx.value?.columnCount ?? 0);
const currentJustification = computed<'left' | 'center' | 'right'>(() => {
  const j = tableCtx.value?.table?.attrs?.justification;
  return j === 'center' || j === 'right' ? j : 'left';
});

// Default style/size/color match TableExtension's solid-border defaults.
// Read in callbacks only — no template/computed consumer, so a plain
// object is sufficient.
const borderSpec: { style: string; size: number; color: { rgb: string } } = {
  style: 'single',
  size: 4,
  color: { rgb: '000000' },
};

// Sync the spec's color with the current cell's existing border color
// so the first "All borders" / "Outside" click on a pre-bordered table
// preserves the visible color instead of stamping black over it.
watch(
  [() => props.view, () => props.stateTick],
  () => {
    const v = props.view;
    if (!v) return;
    const ctx = getTableContext(v.state);
    const c = ctx.cellBorderColor;
    if (!c || !ctx.isInTable) return;
    // `cellBorderColor` is a ColorValue — only the literal rgb shape
    // can flow into the OOXML border spec without theme resolution.
    if (typeof c === 'object' && 'rgb' in c && typeof c.rgb === 'string') {
      borderSpec.color = { rgb: c.rgb };
    }
  },
  { immediate: true }
);

function exec(name: string, ...args: unknown[]): boolean {
  const v = props.view;
  if (!v) return false;
  const factory = props.getCommands()[name];
  if (typeof factory !== 'function') return false;
  const command = factory(...args);
  if (typeof command !== 'function') return false;
  command(v.state, (tr: any) => v.dispatch(tr), v);
  v.focus();
  return true;
}

function onBorderPreset(preset: TableBorderPreset) {
  // Snapshot so the spec stored in PM node attrs doesn't alias our
  // local mutable object.
  const spec = { ...borderSpec, color: { ...borderSpec.color } };
  switch (preset) {
    case 'all':
      exec('setAllTableBorders', spec);
      return;
    case 'none':
      exec('removeTableBorders');
      return;
    case 'box':
      exec('setOutsideTableBorders', spec);
      return;
    case 'inside':
    case 'insideH':
    case 'insideV':
      // BorderPreset has no insideH/insideV split; both fall back to
      // the umbrella "inside" preset.
      exec('setInsideTableBorders', spec);
      return;
    case 'top':
    case 'bottom':
    case 'left':
    case 'right':
      exec('setCellBorder', preset, spec, true);
      return;
  }
}

function onBorderColor(hex: string) {
  borderSpec.color = { rgb: hex.replace(/^#/, '') };
  exec('setTableBorderColor', hex);
}

function onBorderWidth(eighths: number) {
  borderSpec.size = eighths;
  exec('setTableBorderWidth', eighths);
}

function onCellFill(hex: string) {
  exec('setCellFillColor', hex);
}

// Actions whose menu name diverges from the core command name, plus
// their extra args. Everything not in this map falls through to
// `exec(action)` directly.
const moreActionMap: Partial<Record<TableAction, [string, ...unknown[]]>> = {
  autoFit: ['autoFitContents'],
  alignTableLeft: ['setTableProperties', { justification: 'left' }],
  alignTableCenter: ['setTableProperties', { justification: 'center' }],
  alignTableRight: ['setTableProperties', { justification: 'right' }],
  verticalAlignTop: ['setCellVerticalAlign', 'top'],
  verticalAlignMiddle: ['setCellVerticalAlign', 'center'],
  verticalAlignBottom: ['setCellVerticalAlign', 'bottom'],
};

function onMoreAction(action: TableAction) {
  // Dialog action is a v1.x followup — explicit no-op so the menu
  // closes cleanly without dispatching a phantom command.
  if (action === 'tableProperties') return;
  const mapped = moreActionMap[action];
  if (mapped) exec(...mapped);
  else exec(action);
}

function onCellMargins(margins: { top?: number; bottom?: number; left?: number; right?: number }) {
  exec('setCellMargins', margins);
}

function onCellTextDirection(direction: string | null) {
  exec('setCellTextDirection', direction);
}

function onRowHeight(value: { height: number | null; rule?: 'auto' | 'atLeast' | 'exact' }) {
  exec('setRowHeight', value.height, value.rule);
}
</script>

<style scoped>
.divider {
  width: 1px;
  height: 20px;
  margin: 0 6px;
  background: rgba(226, 232, 240, 0.5);
  flex-shrink: 0;
}
</style>

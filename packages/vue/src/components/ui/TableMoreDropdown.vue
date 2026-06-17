<!--
  Vue port of packages/react/src/components/ui/TableMoreDropdown.tsx —
  compact dropdown for less-used table actions. Close behaviour via the
  shared Popover. Also surfaces the advanced cell/row options that React
  only ever wired into its (toolbar-unused) TableOptionsDropdown — cell
  margins, row height + rule, cell text direction — which already have
  core commands (setCellMargins / setRowHeight / setCellTextDirection)
  but had no Vue entry point.
-->
<template>
  <Popover
    :open="isOpen"
    placement="bottom-right"
    @update:open="(v) => (isOpen = v)"
    @close="isOpen = false"
  >
    <template #trigger="{ toggle }">
      <button
        type="button"
        class="docx-tmore__btn"
        :class="{ 'docx-tmore__btn--open': isOpen }"
        :disabled="disabled"
        :title="t('tableAdvanced.tableOptions')"
        @click.prevent="toggle"
      >
        <MaterialSymbol name="more_vert" :size="20" />
      </button>
    </template>
    <template #panel>
      <div class="docx-tmore__panel" role="menu" :aria-label="t('tableAdvanced.tableOptionsMenu')">
        <!-- Insert -->
        <button type="button" class="docx-tmore__item" @click.prevent="select('addRowAbove')">
          <MaterialSymbol name="add" :size="18" /><span>{{ t('table.insertRowAbove') }}</span>
        </button>
        <button type="button" class="docx-tmore__item" @click.prevent="select('addRowBelow')">
          <MaterialSymbol name="add" :size="18" /><span>{{ t('table.insertRowBelow') }}</span>
        </button>
        <button type="button" class="docx-tmore__item" @click.prevent="select('addColumnLeft')">
          <MaterialSymbol name="add" :size="18" /><span>{{ t('table.insertColumnLeft') }}</span>
        </button>
        <button type="button" class="docx-tmore__item" @click.prevent="select('addColumnRight')">
          <MaterialSymbol name="add" :size="18" /><span>{{ t('table.insertColumnRight') }}</span>
        </button>

        <div class="docx-tmore__separator" />

        <!-- Merge / split -->
        <button
          type="button"
          class="docx-tmore__item"
          :disabled="isDisabled('mergeCells')"
          @click.prevent="select('mergeCells')"
        >
          <MaterialSymbol name="call_merge" :size="18" /><span>{{ t('table.mergeCells') }}</span>
        </button>
        <button
          type="button"
          class="docx-tmore__item"
          :disabled="isDisabled('splitCell')"
          @click.prevent="select('splitCell')"
        >
          <MaterialSymbol name="call_split" :size="18" /><span>{{ t('table.splitCell') }}</span>
        </button>

        <div class="docx-tmore__separator" />

        <!-- Select -->
        <button type="button" class="docx-tmore__item" @click.prevent="select('selectTable')">
          <MaterialSymbol name="select_all" :size="18" /><span>{{ t('table.selectTable') }}</span>
        </button>

        <div class="docx-tmore__separator" />

        <!-- Delete -->
        <button
          type="button"
          class="docx-tmore__item docx-tmore__item--danger"
          :disabled="isDisabled('deleteRow')"
          @click.prevent="select('deleteRow')"
        >
          <MaterialSymbol name="delete" :size="18" /><span>{{ t('table.deleteRow') }}</span>
        </button>
        <button
          type="button"
          class="docx-tmore__item docx-tmore__item--danger"
          :disabled="isDisabled('deleteColumn')"
          @click.prevent="select('deleteColumn')"
        >
          <MaterialSymbol name="delete" :size="18" /><span>{{ t('table.deleteColumn') }}</span>
        </button>
        <button
          type="button"
          class="docx-tmore__item docx-tmore__item--danger"
          @click.prevent="select('deleteTable')"
        >
          <MaterialSymbol name="delete" :size="18" /><span>{{ t('table.deleteTable') }}</span>
        </button>

        <div class="docx-tmore__separator" />

        <!-- Vertical alignment -->
        <div class="docx-tmore__section-label">{{ t('tableAdvanced.verticalAlignment') }}</div>
        <div class="docx-tmore__icon-row">
          <button
            type="button"
            class="docx-tmore__icon-btn"
            :title="t('tableAdvanced.top')"
            @mousedown.prevent
            @click.prevent="select('verticalAlignTop')"
          >
            <MaterialSymbol name="vertical_align_top" :size="16" />
          </button>
          <button
            type="button"
            class="docx-tmore__icon-btn"
            :title="t('tableAdvanced.middle')"
            @mousedown.prevent
            @click.prevent="select('verticalAlignMiddle')"
          >
            <MaterialSymbol name="vertical_align_center" :size="16" />
          </button>
          <button
            type="button"
            class="docx-tmore__icon-btn"
            :title="t('tableAdvanced.bottom')"
            @mousedown.prevent
            @click.prevent="select('verticalAlignBottom')"
          >
            <MaterialSymbol name="vertical_align_bottom" :size="16" />
          </button>
        </div>

        <div class="docx-tmore__separator" />

        <!-- Table alignment -->
        <div class="docx-tmore__section-label">{{ t('tableAdvanced.tableAlignment') }}</div>
        <div class="docx-tmore__icon-row">
          <button
            type="button"
            class="docx-tmore__icon-btn"
            :class="{ 'docx-tmore__icon-btn--active': currentJustification === 'left' }"
            :title="t('tableAdvanced.alignTableLeft')"
            @mousedown.prevent
            @click.prevent="select('alignTableLeft')"
          >
            <MaterialSymbol name="format_align_left" :size="16" />
          </button>
          <button
            type="button"
            class="docx-tmore__icon-btn"
            :class="{ 'docx-tmore__icon-btn--active': currentJustification === 'center' }"
            :title="t('tableAdvanced.alignTableCenter')"
            @mousedown.prevent
            @click.prevent="select('alignTableCenter')"
          >
            <MaterialSymbol name="format_align_center" :size="16" />
          </button>
          <button
            type="button"
            class="docx-tmore__icon-btn"
            :class="{ 'docx-tmore__icon-btn--active': currentJustification === 'right' }"
            :title="t('tableAdvanced.alignTableRight')"
            @mousedown.prevent
            @click.prevent="select('alignTableRight')"
          >
            <MaterialSymbol name="format_align_right" :size="16" />
          </button>
        </div>

        <div class="docx-tmore__separator" />

        <!-- Cell margins (expandable) -->
        <button type="button" class="docx-tmore__item" @click.prevent="marginsOpen = !marginsOpen">
          <MaterialSymbol name="padding" :size="18" />
          <span class="docx-tmore__grow">{{ t('tableAdvanced.cellMargins') }}</span>
          <MaterialSymbol :name="marginsOpen ? 'expand_less' : 'expand_more'" :size="18" />
        </button>
        <div v-if="marginsOpen" class="docx-tmore__sub">
          <div class="docx-tmore__margin-grid">
            <label
              v-for="side in (['top', 'bottom', 'left', 'right'] as const)"
              :key="side"
              class="docx-tmore__field"
            >
              <span class="docx-tmore__field-label">{{ side }}</span>
              <input
                type="number"
                min="0"
                step="20"
                v-model.number="marginValues[side]"
                class="docx-tmore__input"
              />
              <span class="docx-tmore__unit">tw</span>
            </label>
          </div>
          <button type="button" class="docx-tmore__apply" @click.prevent="applyMargins">
            {{ t('common.apply') }}
          </button>
        </div>

        <!-- Row height (expandable) -->
        <button type="button" class="docx-tmore__item" @click.prevent="heightOpen = !heightOpen">
          <MaterialSymbol name="height" :size="18" />
          <span class="docx-tmore__grow">{{ t('tableAdvanced.rowHeight') }}</span>
          <MaterialSymbol :name="heightOpen ? 'expand_less' : 'expand_more'" :size="18" />
        </button>
        <div v-if="heightOpen" class="docx-tmore__sub">
          <label class="docx-tmore__row-field">
            <span class="docx-tmore__field-label">{{ t('tableAdvanced.rule') }}</span>
            <select v-model="heightRule" class="docx-tmore__select">
              <option value="auto">{{ t('tableAdvanced.heightRules.auto') }}</option>
              <option value="atLeast">{{ t('tableAdvanced.heightRules.atLeast') }}</option>
              <option value="exact">{{ t('tableAdvanced.heightRules.exact') }}</option>
            </select>
          </label>
          <label v-if="heightRule !== 'auto'" class="docx-tmore__row-field">
            <span class="docx-tmore__field-label">{{ t('tableAdvanced.height') }}</span>
            <input
              type="number"
              min="0"
              step="20"
              v-model.number="heightValue"
              class="docx-tmore__input"
            />
            <span class="docx-tmore__unit">tw</span>
          </label>
          <button type="button" class="docx-tmore__apply" @click.prevent="applyHeight">
            {{ t('common.apply') }}
          </button>
        </div>

        <!-- Cell text direction (expandable) -->
        <button type="button" class="docx-tmore__item" @click.prevent="dirOpen = !dirOpen">
          <MaterialSymbol name="text_rotation_none" :size="18" />
          <span class="docx-tmore__grow">{{ t('tableAdvanced.textDirection') }}</span>
          <MaterialSymbol :name="dirOpen ? 'expand_less' : 'expand_more'" :size="18" />
        </button>
        <div v-if="dirOpen" class="docx-tmore__sub docx-tmore__sub--list">
          <button type="button" class="docx-tmore__sub-item" @click.prevent="applyDirection(null)">
            {{ t('tableAdvanced.textDirections.horizontal') }}
          </button>
          <button type="button" class="docx-tmore__sub-item" @click.prevent="applyDirection('tbRl')">
            {{ t('tableAdvanced.textDirections.verticalRL') }}
          </button>
          <button type="button" class="docx-tmore__sub-item" @click.prevent="applyDirection('btLr')">
            {{ t('tableAdvanced.textDirections.verticalLR') }}
          </button>
        </div>

        <div class="docx-tmore__separator" />

        <!-- Other toggles -->
        <button type="button" class="docx-tmore__item" @click.prevent="select('toggleHeaderRow')">
          <MaterialSymbol name="table_rows" :size="18" /><span>{{
            t('tableAdvanced.toggleHeaderRow')
          }}</span>
        </button>
        <button type="button" class="docx-tmore__item" @click.prevent="select('distributeColumns')">
          <MaterialSymbol name="view_column" :size="18" /><span>{{
            t('tableAdvanced.distributeColumns')
          }}</span>
        </button>
        <button type="button" class="docx-tmore__item" @click.prevent="select('autoFit')">
          <MaterialSymbol name="fit_width" :size="18" /><span>{{ t('tableAdvanced.autoFit') }}</span>
        </button>
        <button type="button" class="docx-tmore__item" @click.prevent="select('toggleNoWrap')">
          <MaterialSymbol name="wrap_text" :size="18" /><span>{{
            t('tableAdvanced.toggleNoWrap')
          }}</span>
        </button>

        <div class="docx-tmore__separator" />

        <button type="button" class="docx-tmore__item" @click.prevent="select('tableProperties')">
          <MaterialSymbol name="settings" :size="18" /><span>{{
            t('tableAdvanced.tableProperties')
          }}</span>
        </button>
      </div>
    </template>
  </Popover>
</template>

<script setup lang="ts">
import { ref, reactive, watch } from 'vue';
import MaterialSymbol from './MaterialSymbol.vue';
import Popover from './Popover.vue';
import { useTranslation } from '../../i18n';

export type TableAction =
  | 'addRowAbove'
  | 'addRowBelow'
  | 'addColumnLeft'
  | 'addColumnRight'
  | 'mergeCells'
  | 'splitCell'
  | 'deleteRow'
  | 'deleteColumn'
  | 'deleteTable'
  | 'selectTable'
  | 'toggleHeaderRow'
  | 'distributeColumns'
  | 'autoFit'
  | 'toggleNoWrap'
  | 'alignTableLeft'
  | 'alignTableCenter'
  | 'alignTableRight'
  | 'verticalAlignTop'
  | 'verticalAlignMiddle'
  | 'verticalAlignBottom'
  | 'tableProperties';

type HeightRule = 'auto' | 'atLeast' | 'exact';

const props = withDefaults(
  defineProps<{
    disabled?: boolean;
    /** Current cell spans more than one row/col → "Split cell" enabled. */
    canSplit?: boolean;
    /** A multi-cell selection is active → "Merge cells" enabled. */
    canMerge?: boolean;
    /** Rows in the current table — "Delete row" is disabled at 1. */
    rowCount?: number;
    /** Columns in the current table — "Delete column" is disabled at 1. */
    columnCount?: number;
    /** Active table justification, for the align-table active-state. */
    currentJustification?: 'left' | 'center' | 'right';
  }>(),
  {
    disabled: false,
    canSplit: false,
    canMerge: false,
    rowCount: 0,
    columnCount: 0,
    currentJustification: 'left',
  }
);

const emit = defineEmits<{
  (e: 'action', action: TableAction): void;
  (
    e: 'cell-margins',
    margins: { top?: number; bottom?: number; left?: number; right?: number }
  ): void;
  (e: 'cell-text-direction', direction: string | null): void;
  (e: 'row-height', value: { height: number | null; rule?: HeightRule }): void;
}>();

const { t } = useTranslation();
const isOpen = ref(false);

// Expandable sub-rows + their working values. Independent (matching
// React's TableOptionsDropdown); reset when the dropdown closes so the
// next open starts clean.
const marginsOpen = ref(false);
const heightOpen = ref(false);
const dirOpen = ref(false);
const marginValues = reactive({ top: 0, bottom: 0, left: 108, right: 108 });
const heightValue = ref(0);
const heightRule = ref<HeightRule>('atLeast');

watch(isOpen, (open) => {
  if (!open) {
    marginsOpen.value = false;
    heightOpen.value = false;
    dirOpen.value = false;
  }
});

function isDisabled(action: TableAction): boolean {
  if (props.disabled) return true;
  if (action === 'splitCell') return !props.canSplit;
  if (action === 'mergeCells') return !props.canMerge;
  if (action === 'deleteRow') return (props.rowCount ?? 0) <= 1;
  if (action === 'deleteColumn') return (props.columnCount ?? 0) <= 1;
  return false;
}

function select(action: TableAction) {
  if (isDisabled(action)) return;
  emit('action', action);
  isOpen.value = false;
}

// `v-model.number` returns the raw string when the field is left empty,
// so coerce every value to a finite number before it reaches the cell
// attrs (a stray '' would otherwise be persisted and round-tripped as 0).
const toTw = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

function applyMargins() {
  emit('cell-margins', {
    top: toTw(marginValues.top),
    bottom: toTw(marginValues.bottom),
    left: toTw(marginValues.left),
    right: toTw(marginValues.right),
  });
  isOpen.value = false;
}

function applyHeight() {
  const h = toTw(heightValue.value);
  if (heightRule.value === 'auto' || h <= 0) {
    emit('row-height', { height: null });
  } else {
    emit('row-height', { height: h, rule: heightRule.value });
  }
  isOpen.value = false;
}

function applyDirection(direction: string | null) {
  emit('cell-text-direction', direction);
  isOpen.value = false;
}
</script>

<style scoped>
.docx-tmore__btn {
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--doc-text-muted);
  cursor: pointer;
}
.docx-tmore__btn:hover:not(:disabled) {
  background: var(--doc-bg-hover);
}
.docx-tmore__btn--open {
  background: var(--doc-bg-hover);
}
.docx-tmore__panel {
  min-width: 220px;
  padding: 4px 0;
  max-height: 70vh;
  overflow-y: auto;
}
.docx-tmore__item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 14px;
  font-size: 13px;
  color: var(--doc-text-muted);
  cursor: pointer;
  border: none;
  background: transparent;
  width: 100%;
  text-align: left;
}
.docx-tmore__item:hover:not(:disabled) {
  background: var(--doc-bg-hover);
}
.docx-tmore__item:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.docx-tmore__item--danger:not(:disabled) {
  color: var(--doc-error);
}
.docx-tmore__grow {
  flex: 1;
}
.docx-tmore__separator {
  height: 1px;
  background: var(--doc-border);
  margin: 4px 0;
}
.docx-tmore__section-label {
  padding: 6px 14px 2px;
  font-size: 11px;
  color: var(--doc-text-subtle);
  font-weight: 500;
}
.docx-tmore__icon-row {
  display: flex;
  gap: 4px;
  padding: 4px 14px;
}
.docx-tmore__icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 28px;
  border: 1px solid var(--doc-border-dark);
  border-radius: 4px;
  background: transparent;
  color: var(--doc-text-muted);
  cursor: pointer;
}
.docx-tmore__icon-btn:hover {
  background: var(--doc-bg-hover);
}
.docx-tmore__icon-btn--active {
  background: var(--doc-primary-light);
  border-color: var(--doc-primary);
  color: var(--doc-primary);
}
.docx-tmore__sub {
  background: var(--doc-bg);
  border-top: 1px solid var(--doc-border);
  border-bottom: 1px solid var(--doc-border);
  padding: 8px 14px;
}
.docx-tmore__sub--list {
  padding: 4px 0;
}
.docx-tmore__sub-item {
  display: flex;
  align-items: center;
  width: 100%;
  padding: 6px 14px;
  font-size: 13px;
  color: var(--doc-text-muted);
  border: none;
  background: transparent;
  text-align: left;
  cursor: pointer;
}
.docx-tmore__sub-item:hover {
  background: var(--doc-bg-hover);
}
.docx-tmore__margin-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}
.docx-tmore__field,
.docx-tmore__row-field {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
}
.docx-tmore__row-field {
  margin-bottom: 6px;
}
.docx-tmore__field-label {
  width: 42px;
  text-transform: capitalize;
  color: var(--doc-text-muted);
}
.docx-tmore__input,
.docx-tmore__select {
  flex: 1;
  min-width: 0;
  padding: 2px 4px;
  border: 1px solid var(--doc-border-dark);
  border-radius: 3px;
  font-size: 12px;
}
.docx-tmore__unit {
  font-size: 10px;
  color: var(--doc-text-subtle);
}
.docx-tmore__apply {
  margin-top: 6px;
  width: 100%;
  padding: 4px 12px;
  font-size: 12px;
  border: 1px solid var(--doc-primary);
  border-radius: 4px;
  background: var(--doc-primary);
  color: var(--doc-on-primary);
  cursor: pointer;
}
.docx-tmore__apply:hover {
  background: var(--doc-primary-hover);
}
</style>

<template>
  <div v-if="isOpen" class="dialog-overlay" @mousedown.self="close">
    <div class="dialog" @mousedown.stop @keydown.stop="onKeydown">
      <div class="dialog__header">
        <span class="dialog__title">{{ t('dialogs.insertTable.title') }}</span>
        <button class="dialog__close" :title="t('common.closeDialog')" @click="close">✕</button>
      </div>
      <div class="dialog__body">
        <!-- Visual grid picker -->
        <div
          class="table-grid"
          :aria-label="t('dialogs.insertTable.sizeSelector')"
          @mouseleave="
            hoverRow = 0;
            hoverCol = 0;
          "
        >
          <div v-for="r in GRID_ROWS" :key="r" class="table-grid__row">
            <div
              v-for="c in GRID_COLS"
              :key="c"
              class="table-grid__cell"
              :class="{ highlight: r <= hoverRow && c <= hoverCol }"
              @mouseenter="
                hoverRow = r;
                hoverCol = c;
              "
              @mousedown.prevent="pickFromGrid(r, c)"
            ></div>
          </div>
        </div>
        <div class="table-grid__label">
          {{
            hoverRow > 0
              ? t('dialogs.insertTable.tableSize', { cols: hoverCol, rows: hoverRow })
              : t('dialogs.insertTable.hoverToSelect')
          }}
        </div>

        <div class="dialog__separator">
          <span>{{ t('dialogs.insertTable.orSpecifySize') }}</span>
        </div>

        <!-- Manual input -->
        <div class="table-manual">
          <label class="table-manual__field">
            <span>{{ t('dialogs.insertTable.rowsLabel') }}</span>
            <input
              v-model="rowsInput"
              type="number"
              :min="MIN_ROWS"
              :max="MAX_ROWS"
              class="table-manual__input"
              :class="{ 'table-manual__input--invalid': !rowsValid }"
            />
          </label>
          <label class="table-manual__field">
            <span>{{ t('dialogs.insertTable.columnsLabel') }}</span>
            <input
              v-model="colsInput"
              type="number"
              :min="MIN_COLS"
              :max="MAX_COLS"
              class="table-manual__input"
              :class="{ 'table-manual__input--invalid': !colsValid }"
            />
          </label>
        </div>
        <div class="table-manual__hint" :class="{ 'table-manual__hint--error': !canInsert }">
          {{
            t('dialogs.insertTable.validationHint', {
              minRows: MIN_ROWS,
              maxRows: MAX_ROWS,
              minCols: MIN_COLS,
              maxCols: MAX_COLS,
            })
          }}
        </div>

        <!-- Column width mode -->
        <fieldset class="table-options">
          <legend>{{ t('dialogs.insertTable.columnWidthLabel') }}</legend>
          <label class="table-options__radio">
            <input type="radio" value="fixed" v-model="widthMode" />
            <span>{{ t('dialogs.insertTable.fixedWidth') }}</span>
          </label>
          <label class="table-options__radio">
            <input type="radio" value="autofit" v-model="widthMode" />
            <span>{{ t('dialogs.insertTable.autofit') }}</span>
          </label>
        </fieldset>

        <!-- Preset table styles -->
        <div class="table-options">
          <div class="table-options__label">{{ t('dialogs.insertTable.tableStyleLabel') }}</div>
          <TableStyleGallery :current-style-id="styleId" @apply="onPickStyle" />
        </div>
      </div>
      <div class="dialog__footer">
        <button class="dialog__btn" @mousedown.prevent="close">{{ t('common.cancel') }}</button>
        <button
          class="dialog__btn dialog__btn--primary"
          :disabled="!canInsert"
          @mousedown.prevent="insert()"
        >
          {{ t('dialogs.insertTable.insertButton') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useTranslation } from '../../i18n';
import TableStyleGallery from '../ui/TableStyleGallery.vue';
import { rememberedTableSize } from '../insertTableState';

const { t } = useTranslation();

const props = defineProps<{ isOpen: boolean }>();
const emit = defineEmits<{
  (e: 'close'): void;
  (
    e: 'insert',
    config: { rows: number; cols: number; autofit: boolean; styleId: string | null }
  ): void;
}>();

const GRID_ROWS = 8;
const GRID_COLS = 10;
const MIN_ROWS = 1;
const MAX_ROWS = 100;
const MIN_COLS = 1;
const MAX_COLS = 20;

const hoverRow = ref(0);
const hoverCol = ref(0);
const rowsInput = ref<number | string>(rememberedTableSize.rows);
const colsInput = ref<number | string>(rememberedTableSize.cols);
const widthMode = ref<'fixed' | 'autofit'>('fixed');
const styleId = ref<string | null>(null);

// Re-seed the manual inputs from the remembered values whenever the dialog opens.
watch(
  () => props.isOpen,
  (open) => {
    if (open) {
      rowsInput.value = rememberedTableSize.rows;
      colsInput.value = rememberedTableSize.cols;
      hoverRow.value = 0;
      hoverCol.value = 0;
    }
  }
);

const rowsNum = computed(() => Number.parseInt(String(rowsInput.value), 10));
const colsNum = computed(() => Number.parseInt(String(colsInput.value), 10));
const rowsValid = computed(
  () => Number.isFinite(rowsNum.value) && rowsNum.value >= MIN_ROWS && rowsNum.value <= MAX_ROWS
);
const colsValid = computed(
  () => Number.isFinite(colsNum.value) && colsNum.value >= MIN_COLS && colsNum.value <= MAX_COLS
);
const canInsert = computed(() => rowsValid.value && colsValid.value);

function close() {
  emit('close');
}

function pickFromGrid(rows: number, cols: number) {
  hoverRow.value = rows;
  hoverCol.value = cols;
  rowsInput.value = rows;
  colsInput.value = cols;
}

function onPickStyle(id: string) {
  // Toggle off if the same style is picked again.
  styleId.value = styleId.value === id ? null : id;
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    close();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    insert();
  }
}

function insert() {
  if (!canInsert.value) return;
  const rows = Math.min(Math.max(MIN_ROWS, rowsNum.value), MAX_ROWS);
  const cols = Math.min(Math.max(MIN_COLS, colsNum.value), MAX_COLS);
  rememberedTableSize.rows = rows;
  rememberedTableSize.cols = cols;
  emit('insert', {
    rows,
    cols,
    autofit: widthMode.value === 'autofit',
    styleId: styleId.value,
  });
  close();
}
</script>

<style scoped>
.dialog-overlay {
  position: fixed;
  inset: 0;
  background: var(--doc-overlay);
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
}
.dialog {
  background: var(--doc-surface);
  border-radius: 8px;
  box-shadow: 0 4px 20px var(--doc-shadow);
  min-width: 340px;
  max-width: 90vw;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
}
.dialog__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--doc-border);
}
.dialog__title {
  font-weight: 600;
  font-size: 14px;
  color: var(--doc-text);
}
.dialog__close {
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 14px;
  color: var(--doc-text-muted);
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
}
.dialog__close:hover {
  background: var(--doc-bg-hover);
}
.dialog__body {
  padding: 16px;
  overflow-y: auto;
}
.dialog__footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--doc-border);
}
.dialog__btn {
  padding: 6px 16px;
  border: 1px solid var(--doc-border-dark);
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  background: var(--doc-surface);
  color: var(--doc-text);
}
.dialog__btn:hover {
  background: var(--doc-bg);
}
.dialog__btn--primary {
  background: var(--doc-primary);
  color: var(--doc-on-primary);
  border-color: var(--doc-primary);
}
.dialog__btn--primary:hover {
  background: var(--doc-primary);
}
.dialog__btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.dialog__btn--primary:disabled:hover {
  background: var(--doc-primary);
}
.dialog__separator {
  display: flex;
  align-items: center;
  margin: 14px 0 12px;
  color: var(--doc-text-subtle);
  font-size: 12px;
}
.dialog__separator::before,
.dialog__separator::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--doc-border);
}
.dialog__separator span {
  padding: 0 10px;
}

.table-grid {
  display: inline-flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px;
  border: 1px solid var(--doc-border);
  border-radius: 4px;
}
.table-grid__row {
  display: flex;
  gap: 2px;
}
.table-grid__cell {
  width: 20px;
  height: 20px;
  border: 1px solid var(--doc-border-dark);
  border-radius: 2px;
  cursor: pointer;
  background: var(--doc-surface);
}
.table-grid__cell.highlight {
  background: var(--doc-primary-light);
  border-color: var(--doc-primary-light);
}
.table-grid__label {
  text-align: center;
  margin-top: 6px;
  font-size: 12px;
  color: var(--doc-text-muted);
}

.table-manual {
  display: flex;
  align-items: center;
  gap: 16px;
  font-size: 13px;
}
.table-manual__field {
  display: flex;
  align-items: center;
  gap: 8px;
}
.table-manual__input {
  width: 60px;
  padding: 4px 6px;
  border: 1px solid var(--doc-border-dark);
  border-radius: 4px;
  font-size: 13px;
  text-align: center;
}
.table-manual__input--invalid {
  border-color: var(--doc-error);
}
.table-manual__hint {
  margin-top: 6px;
  font-size: 11px;
  color: var(--doc-text-subtle);
}
.table-manual__hint--error {
  color: var(--doc-error);
}

.table-options {
  margin-top: 16px;
  border: none;
  padding: 0;
}
.table-options legend,
.table-options__label {
  font-size: 12px;
  font-weight: 600;
  color: var(--doc-text-muted);
  margin-bottom: 6px;
  padding: 0;
}
.table-options__radio {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--doc-text);
  margin-bottom: 4px;
}
</style>

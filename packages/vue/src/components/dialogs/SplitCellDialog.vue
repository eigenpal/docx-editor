<!--
  Vue port of packages/react/src/components/dialogs/SplitCellDialog.tsx —
  modal dialog with two number inputs for rows × columns, applied via
  emit('apply', rows, cols).
-->
<template>
  <div v-if="isOpen" class="docx-split-cell" @click.self="$emit('close')">
    <div class="docx-split-cell__dialog">
      <div class="docx-split-cell__header">{{ t('dialogs.splitCell.title') }}</div>
      <div class="docx-split-cell__body">
        <label class="docx-split-cell__row">
          <span class="docx-split-cell__label">{{ t('dialogs.splitCell.rowsLabel') }}</span>
          <input
            v-model.number="rows"
            type="number"
            class="docx-split-cell__input"
            :min="minRows"
            :max="20"
            @keydown.enter.prevent="apply"
          />
        </label>
        <label class="docx-split-cell__row">
          <span class="docx-split-cell__label">{{ t('dialogs.splitCell.columnsLabel') }}</span>
          <input
            v-model.number="cols"
            type="number"
            class="docx-split-cell__input"
            :min="minCols"
            :max="20"
            @keydown.enter.prevent="apply"
          />
        </label>
      </div>
      <div class="docx-split-cell__footer">
        <button class="docx-split-cell__cancel" @click="$emit('close')">{{ t('common.cancel') }}</button>
        <button class="docx-split-cell__apply" :disabled="!valid" @click="apply">{{ t('common.apply') }}</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useTranslation } from '../../i18n';

const { t } = useTranslation();

const props = withDefaults(
  defineProps<{
    isOpen: boolean;
    initialRows?: number;
    initialCols?: number;
    minRows?: number;
    minCols?: number;
  }>(),
  { initialRows: 1, initialCols: 2, minRows: 1, minCols: 1 }
);

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'apply', rows: number, cols: number): void;
}>();

const rows = ref(props.initialRows);
const cols = ref(props.initialCols);

watch(
  () => props.isOpen,
  (open) => {
    if (open) {
      rows.value = props.initialRows;
      cols.value = props.initialCols;
    }
  }
);

const valid = computed(
  () =>
    Number.isFinite(rows.value) &&
    Number.isFinite(cols.value) &&
    rows.value >= props.minRows &&
    cols.value >= props.minCols &&
    rows.value * cols.value > 1
);

function apply() {
  if (!valid.value) return;
  emit('apply', rows.value, cols.value);
}
</script>

<style scoped>
.docx-split-cell {
  position: fixed;
  inset: 0;
  background: var(--doc-overlay);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
}
.docx-split-cell__dialog {
  background: var(--doc-surface);
  border-radius: 8px;
  box-shadow: 0 4px 20px var(--doc-shadow);
  min-width: 360px;
  max-width: 440px;
  width: 100%;
  margin: 20px;
}
.docx-split-cell__header {
  padding: 16px 20px 12px;
  border-bottom: 1px solid var(--doc-border);
  font-size: 16px;
  font-weight: 600;
}
.docx-split-cell__body {
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.docx-split-cell__row {
  display: flex;
  align-items: center;
  gap: 12px;
}
.docx-split-cell__label {
  width: 160px;
  font-size: 13px;
  color: var(--doc-text);
}
.docx-split-cell__input {
  flex: 1;
  height: 32px;
  border: 1px solid var(--doc-border-dark);
  border-radius: 4px;
  padding: 0 8px;
  font-size: 13px;
}
.docx-split-cell__footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 20px 16px;
}
.docx-split-cell__cancel,
.docx-split-cell__apply {
  padding: 6px 16px;
  font-size: 14px;
  border-radius: 4px;
  cursor: pointer;
  border: 1px solid var(--doc-border-dark);
  background: var(--doc-surface);
}
.docx-split-cell__apply {
  background: var(--doc-primary);
  border-color: var(--doc-primary);
  color: var(--doc-on-primary);
}
.docx-split-cell__apply:disabled {
  background: var(--doc-bg-hover);
  border-color: var(--doc-bg-hover);
  color: var(--doc-text-subtle);
  cursor: not-allowed;
}
</style>

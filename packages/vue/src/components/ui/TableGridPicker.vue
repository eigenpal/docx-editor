<!--
  Vue port of packages/react/src/components/ui/TableGridPicker.tsx —
  click the grid_on button → 5x5 grid panel for selecting table
  dimensions → emit insert(rows, cols). Close behaviour via shared
  Popover.
-->
<template>
  <Popover :open="isOpen" @update:open="(v) => (isOpen = v)" @close="onClose">
    <template #trigger="{ toggle }">
      <button
        type="button"
        class="docx-table-grid__btn"
        :disabled="disabled"
        :aria-expanded="isOpen"
        aria-haspopup="grid"
        :title="tooltip"
        @click.prevent="toggle"
      >
        <MaterialSymbol name="grid_on" :size="20" />
      </button>
    </template>
    <template #panel>
      <div class="docx-table-grid__panel">
        <div class="docx-table-grid__label">{{ hover.rows }} × {{ hover.cols }}</div>
        <div
          class="docx-table-grid__grid"
          :style="{ gridTemplateColumns: `repeat(${gridColumns}, 18px)` }"
        >
          <button
            v-for="cell in cells"
            :key="`${cell.r}-${cell.c}`"
            class="docx-table-grid__cell"
            :class="{ 'docx-table-grid__cell--active': cell.r <= hover.rows && cell.c <= hover.cols }"
            @mouseenter="hover = { rows: cell.r, cols: cell.c }"
            @click.prevent="handleInsert(cell.r, cell.c)"
          />
        </div>
      </div>
    </template>
  </Popover>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import MaterialSymbol from './MaterialSymbol.vue';
import Popover from './Popover.vue';

const props = withDefaults(
  defineProps<{
    disabled?: boolean;
    gridRows?: number;
    gridColumns?: number;
    tooltip?: string;
  }>(),
  { disabled: false, gridRows: 5, gridColumns: 5, tooltip: 'Insert table' }
);

const emit = defineEmits<{
  (e: 'insert', rows: number, cols: number): void;
}>();

const isOpen = ref(false);
const hover = ref({ rows: 1, cols: 1 });

const cells = computed(() => {
  const out: { r: number; c: number }[] = [];
  for (let r = 1; r <= props.gridRows; r++) {
    for (let c = 1; c <= props.gridColumns; c++) {
      out.push({ r, c });
    }
  }
  return out;
});

function handleInsert(rows: number, cols: number) {
  emit('insert', rows, cols);
  isOpen.value = false;
}

function onClose() {
  isOpen.value = false;
  hover.value = { rows: 1, cols: 1 };
}
</script>

<style scoped>
.docx-table-grid__btn {
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #64748b;
  cursor: pointer;
}
.docx-table-grid__btn:hover:not(:disabled) {
  background: rgba(241, 245, 249, 0.8);
  color: #0f172a;
}
.docx-table-grid__btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}
.docx-table-grid__panel {
  padding: 8px;
}
.docx-table-grid__label {
  font-size: 12px;
  text-align: center;
  color: #5f6368;
  margin-bottom: 6px;
}
.docx-table-grid__grid {
  display: grid;
  gap: 2px;
}
.docx-table-grid__cell {
  width: 18px;
  height: 18px;
  border: 1px solid #d1d5db;
  background: #fff;
  cursor: pointer;
  padding: 0;
}
.docx-table-grid__cell--active {
  background: #1a73e8;
  border-color: #1a73e8;
}
</style>

<template>
  <div v-if="isOpen" class="dialog-overlay" @mousedown.self="close">
    <div class="dialog" @mousedown.stop @keydown.stop>
      <div class="dialog__header">
        <span class="dialog__title">Insert Table</span>
        <button class="dialog__close" @click="close">✕</button>
      </div>
      <div class="dialog__body">
        <!-- Visual grid picker -->
        <div class="table-grid" @mouseleave="hoverRow = 0; hoverCol = 0">
          <div v-for="r in 8" :key="r" class="table-grid__row">
            <div
              v-for="c in 10" :key="c"
              class="table-grid__cell"
              :class="{ highlight: r <= hoverRow && c <= hoverCol }"
              @mouseenter="hoverRow = r; hoverCol = c"
              @mousedown.prevent="insert(hoverRow, hoverCol)"
            ></div>
          </div>
        </div>
        <div class="table-grid__label">{{ hoverRow > 0 ? `${hoverRow} × ${hoverCol}` : 'Select size' }}</div>

        <!-- Manual input -->
        <div class="table-manual">
          <label>Rows: <input v-model.number="manualRows" type="number" min="1" max="100" class="table-manual__input" /></label>
          <label>Columns: <input v-model.number="manualCols" type="number" min="1" max="20" class="table-manual__input" /></label>
          <button class="dialog__btn dialog__btn--primary" @mousedown.prevent="insert(manualRows, manualCols)">Insert</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';

defineProps<{ isOpen: boolean }>();
const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'insert', rows: number, cols: number): void;
}>();

const hoverRow = ref(0);
const hoverCol = ref(0);
const manualRows = ref(3);
const manualCols = ref(3);

function close() { emit('close'); }
function insert(rows: number, cols: number) {
  if (rows > 0 && cols > 0) {
    emit('insert', Math.min(rows, 100), Math.min(cols, 20));
    close();
  }
}
</script>

<style scoped>
.dialog-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.3); z-index: 300; display: flex; align-items: center; justify-content: center; }
.dialog { background: #fff; border-radius: 8px; box-shadow: 0 8px 30px rgba(0,0,0,0.2); min-width: 300px; max-width: 90vw; }
.dialog__header { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid #e5e7eb; }
.dialog__title { font-weight: 600; font-size: 14px; color: #1f2937; }
.dialog__close { border: none; background: transparent; cursor: pointer; font-size: 14px; color: #6b7280; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; border-radius: 4px; }
.dialog__close:hover { background: #f3f4f6; }
.dialog__body { padding: 16px; }
.dialog__btn { padding: 6px 16px; border: 1px solid #d1d5db; border-radius: 4px; cursor: pointer; font-size: 13px; background: #fff; }
.dialog__btn--primary { background: #3b82f6; color: #fff; border-color: #3b82f6; }
.dialog__btn--primary:hover { background: #2563eb; }

.table-grid { display: inline-flex; flex-direction: column; gap: 2px; padding: 4px; border: 1px solid #e5e7eb; border-radius: 4px; }
.table-grid__row { display: flex; gap: 2px; }
.table-grid__cell { width: 20px; height: 20px; border: 1px solid #d1d5db; border-radius: 2px; cursor: pointer; background: #fff; }
.table-grid__cell.highlight { background: #dbeafe; border-color: #93c5fd; }
.table-grid__label { text-align: center; margin-top: 6px; font-size: 12px; color: #6b7280; }
.table-manual { display: flex; align-items: center; gap: 12px; margin-top: 12px; padding-top: 12px; border-top: 1px solid #e5e7eb; font-size: 13px; }
.table-manual__input { width: 50px; padding: 4px 6px; border: 1px solid #d1d5db; border-radius: 4px; font-size: 13px; }
</style>

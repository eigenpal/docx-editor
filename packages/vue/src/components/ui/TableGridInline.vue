<!--
  Vue port of packages/react/src/components/ui/TableGridInline.tsx —
  inline grid picker for table dimensions (no button wrapper, used by
  menu-bar Insert > Table submenus). TableGridPicker.vue uses this
  pattern internally; this file matches the React file by name for
  consumers that import the inline version directly.
-->
<template>
  <div>
    <div
      class="docx-table-grid-inline__grid"
      :style="{ gridTemplateColumns: `repeat(${gridColumns}, 18px)` }"
      role="grid"
      aria-label="Table size selector"
      @mouseleave="hoverRows = 0; hoverCols = 0"
    >
      <div
        v-for="cell in cells"
        :key="`${cell.r}-${cell.c}`"
        class="docx-table-grid-inline__cell"
        :class="{ 'docx-table-grid-inline__cell--active': cell.r <= hoverRows && cell.c <= hoverCols }"
        role="gridcell"
        :aria-selected="cell.r <= hoverRows && cell.c <= hoverCols"
        @mouseenter="hoverRows = cell.r; hoverCols = cell.c"
        @click.prevent="handleClick"
      />
    </div>
    <div class="docx-table-grid-inline__label">
      {{ hoverRows > 0 && hoverCols > 0 ? `${hoverCols} × ${hoverRows}` : 'Select size' }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';

const props = withDefaults(
  defineProps<{
    gridRows?: number;
    gridColumns?: number;
  }>(),
  { gridRows: 6, gridColumns: 6 }
);

const emit = defineEmits<{
  (e: 'insert', rows: number, cols: number): void;
}>();

const hoverRows = ref(0);
const hoverCols = ref(0);

const cells = computed(() => {
  const out: { r: number; c: number }[] = [];
  for (let r = 1; r <= props.gridRows; r++) {
    for (let c = 1; c <= props.gridColumns; c++) {
      out.push({ r, c });
    }
  }
  return out;
});

function handleClick() {
  if (hoverRows.value > 0 && hoverCols.value > 0) {
    emit('insert', hoverRows.value, hoverCols.value);
  }
}
</script>

<style scoped>
.docx-table-grid-inline__grid {
  display: grid;
  gap: 2px;
}
.docx-table-grid-inline__cell {
  width: 18px;
  height: 18px;
  background: #fff;
  border: 1px solid #d1d5db;
  border-radius: 2px;
  cursor: pointer;
  transition: background-color 0.1s, border-color 0.1s;
}
.docx-table-grid-inline__cell--active {
  background: #3b82f6;
  border-color: #3b82f6;
}
.docx-table-grid-inline__label {
  margin-top: 6px;
  font-size: 11px;
  font-weight: 500;
  color: #374151;
  text-align: center;
}
</style>

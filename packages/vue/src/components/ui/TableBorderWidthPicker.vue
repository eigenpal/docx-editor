<!--
  Vue port of packages/react/src/components/ui/TableBorderWidthPicker.tsx —
  toolbar button + small list panel for border thickness in eighths
  of a point. Close behaviour via shared Popover.
-->
<template>
  <Popover :open="isOpen" @update:open="(v) => (isOpen = v)" @close="isOpen = false">
    <template #trigger="{ toggle }">
      <button
        type="button"
        class="docx-tbwidth__btn"
        :disabled="disabled"
        title="Border width"
        @click.prevent="toggle"
      >
        <MaterialSymbol name="line_weight" :size="20" />
      </button>
    </template>
    <template #panel>
      <div class="docx-tbwidth__panel">
        <button
          v-for="w in WIDTHS"
          :key="w.eighths"
          type="button"
          class="docx-tbwidth__option"
          @click.prevent="pick(w.eighths)"
        >
          <span
            class="docx-tbwidth__preview"
            :style="{ borderTopWidth: w.previewPx + 'px' }"
          />
          <span class="docx-tbwidth__label">{{ w.label }}</span>
        </button>
      </div>
    </template>
  </Popover>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import MaterialSymbol from './MaterialSymbol.vue';
import Popover from './Popover.vue';

defineProps<{ disabled?: boolean }>();

const emit = defineEmits<{
  // OOXML w:sz value: eighths of a point.
  (e: 'change', eighths: number): void;
}>();

const isOpen = ref(false);

const WIDTHS = [
  { label: '0.5pt', eighths: 4, previewPx: 1 },
  { label: '0.75pt', eighths: 6, previewPx: 1 },
  { label: '1pt', eighths: 8, previewPx: 2 },
  { label: '1.5pt', eighths: 12, previewPx: 2 },
  { label: '2.25pt', eighths: 18, previewPx: 3 },
  { label: '3pt', eighths: 24, previewPx: 4 },
  { label: '4.5pt', eighths: 36, previewPx: 6 },
  { label: '6pt', eighths: 48, previewPx: 8 },
];

function pick(eighths: number) {
  emit('change', eighths);
  isOpen.value = false;
}
</script>

<style scoped>
.docx-tbwidth__btn {
  width: 28px; height: 28px;
  display: inline-flex; align-items: center; justify-content: center;
  border: none; border-radius: 6px;
  background: transparent; color: var(--doc-text-muted); cursor: pointer;
}
.docx-tbwidth__btn:hover:not(:disabled) { background: var(--doc-bg-hover); }
.docx-tbwidth__panel {
  padding: 4px 0;
  min-width: 120px;
}
.docx-tbwidth__option {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 6px 12px;
  border: none;
  background: transparent;
  cursor: pointer;
  text-align: left;
}
.docx-tbwidth__option:hover { background: var(--doc-bg-hover); }
.docx-tbwidth__preview {
  flex-shrink: 0;
  display: inline-block;
  width: 40px;
  border-top: 1px solid var(--doc-text);
}
.docx-tbwidth__label {
  font-size: 13px;
  color: var(--doc-text);
}
</style>

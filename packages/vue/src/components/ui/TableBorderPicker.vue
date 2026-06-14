<!--
  Vue port of packages/react/src/components/ui/TableBorderPicker.tsx —
  toolbar button + grid panel for which sides get a border. Close
  behaviour via shared Popover.
-->
<template>
  <Popover :open="isOpen" @update:open="(v) => (isOpen = v)" @close="isOpen = false">
    <template #trigger="{ toggle }">
      <button
        type="button"
        class="docx-tbp__btn"
        :disabled="disabled"
        title="Borders"
        @click.prevent="toggle"
      >
        <MaterialSymbol name="border_all" :size="20" />
      </button>
    </template>
    <template #panel>
      <div class="docx-tbp__panel">
        <button
          v-for="o in OPTIONS"
          :key="o.value"
          type="button"
          class="docx-tbp__option"
          :title="o.label"
          @click.prevent="pick(o.value)"
        >
          <MaterialSymbol :name="o.icon" :size="20" />
        </button>
      </div>
    </template>
  </Popover>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import MaterialSymbol from './MaterialSymbol.vue';
import Popover from './Popover.vue';

export type TableBorderPreset =
  | 'all'
  | 'none'
  | 'box'
  | 'inside'
  | 'top'
  | 'bottom'
  | 'left'
  | 'right'
  | 'insideH'
  | 'insideV';

defineProps<{ disabled?: boolean }>();

const emit = defineEmits<{
  (e: 'change', preset: TableBorderPreset): void;
}>();

const isOpen = ref(false);

const OPTIONS: { value: TableBorderPreset; icon: string; label: string }[] = [
  { value: 'all', icon: 'border_all', label: 'All borders' },
  { value: 'none', icon: 'border_clear', label: 'No borders' },
  { value: 'box', icon: 'border_outer', label: 'Outside borders' },
  { value: 'inside', icon: 'border_inner', label: 'Inside borders' },
  { value: 'top', icon: 'border_top', label: 'Top border' },
  { value: 'bottom', icon: 'border_bottom', label: 'Bottom border' },
  { value: 'left', icon: 'border_left', label: 'Left border' },
  { value: 'right', icon: 'border_right', label: 'Right border' },
  { value: 'insideH', icon: 'border_horizontal', label: 'Inside horizontal' },
  { value: 'insideV', icon: 'border_vertical', label: 'Inside vertical' },
];

function pick(preset: TableBorderPreset) {
  emit('change', preset);
  isOpen.value = false;
}
</script>

<style scoped>
.docx-tbp__btn {
  width: 28px; height: 28px;
  display: inline-flex; align-items: center; justify-content: center;
  border: none; border-radius: 6px;
  background: transparent; color: var(--doc-text-muted); cursor: pointer;
}
.docx-tbp__btn:hover:not(:disabled) { background: var(--doc-bg-hover); }
.docx-tbp__panel {
  display: grid;
  grid-template-columns: repeat(5, 32px);
  gap: 2px;
  padding: 4px;
}
.docx-tbp__option {
  width: 32px; height: 32px;
  display: inline-flex; align-items: center; justify-content: center;
  border: none; border-radius: 4px;
  background: transparent; color: var(--doc-text-muted); cursor: pointer;
}
.docx-tbp__option:hover { background: var(--doc-bg-hover); }
</style>

<!--
  Vue port of packages/react/src/components/ui/IconGridDropdown.tsx —
  generic icon-row dropdown used by image toolbar controls. Same
  trigger + chevron + active-highlight; close behaviour goes
  through the shared Popover (Escape + scroll handled centrally).
-->
<template>
  <Popover :open="isOpen" @update:open="(v) => (isOpen = v)" @close="isOpen = false">
    <template #trigger="{ toggle }">
      <button
        type="button"
        class="docx-icon-grid__btn"
        :class="{ 'docx-icon-grid__btn--open': isOpen }"
        :disabled="disabled"
        :aria-label="ariaLabel ?? tooltipContent"
        :title="tooltipContent"
        :aria-expanded="isOpen"
        aria-haspopup="true"
        @click.prevent="toggle"
      >
        <MaterialSymbol :name="triggerIcon" :size="20" />
        <MaterialSymbol name="arrow_drop_down" :size="14" />
      </button>
    </template>
    <template #panel>
      <div class="docx-icon-grid__panel">
        <button
          v-for="o in options"
          :key="o.value"
          type="button"
          class="docx-icon-grid__option"
          :class="{ 'docx-icon-grid__option--active': activeValue === o.value }"
          :title="o.label"
          @click.prevent="select(o.value)"
        >
          <MaterialSymbol :name="o.iconName" :size="18" />
        </button>
      </div>
    </template>
  </Popover>
</template>

<script setup lang="ts" generic="T extends string">
import { ref } from 'vue';
import MaterialSymbol from './MaterialSymbol.vue';
import Popover from './Popover.vue';

export interface IconGridOption<V extends string = string> {
  value: V;
  label: string;
  iconName: string;
}

defineProps<{
  options: IconGridOption<T>[];
  activeValue?: T | null;
  triggerIcon: string;
  tooltipContent: string;
  disabled?: boolean;
  ariaLabel?: string;
}>();

const emit = defineEmits<{
  (e: 'select', value: T): void;
}>();

const isOpen = ref(false);

function select(value: T) {
  emit('select', value);
  isOpen.value = false;
}
</script>

<style scoped>
.docx-icon-grid__btn {
  display: inline-flex;
  align-items: center;
  gap: 0;
  height: 28px;
  padding: 0 4px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #64748b;
  cursor: pointer;
}
.docx-icon-grid__btn:hover:not(:disabled) {
  background: rgba(241, 245, 249, 0.8);
  color: #0f172a;
}
.docx-icon-grid__btn--open { background: #f1f5f9; }
.docx-icon-grid__btn:disabled { opacity: 0.3; cursor: not-allowed; }
.docx-icon-grid__panel {
  display: flex;
  gap: 2px;
  padding: 6px;
  border-radius: 8px;
}
.docx-icon-grid__option {
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: #5f6368;
  cursor: pointer;
}
.docx-icon-grid__option:hover { background: #f3f4f6; }
.docx-icon-grid__option--active {
  background: rgba(26, 115, 232, 0.12);
  color: #1a73e8;
}
</style>

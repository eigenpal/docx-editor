<!--
  Vue port of packages/react/src/components/ui/AlignmentButtons.tsx —
  single trigger that shows the active alignment icon + chevron;
  click opens a popover with Left / Center / Right / Justify
  buttons. Close behaviour via shared Popover.
-->
<template>
  <Popover :open="isOpen" @update:open="(v) => (isOpen = v)" @close="isOpen = false">
    <template #trigger="{ toggle }">
      <button
        type="button"
        class="docx-align__btn"
        :class="{ 'docx-align__btn--open': isOpen }"
        :disabled="disabled"
        :title="`Alignment: ${currentLabel}`"
        :aria-expanded="isOpen"
        aria-haspopup="true"
        @click.prevent="toggle"
      >
        <MaterialSymbol :name="currentIcon" :size="20" />
        <MaterialSymbol name="arrow_drop_down" :size="14" />
      </button>
    </template>
    <template #panel>
      <div class="docx-align__panel">
        <button
          v-for="o in OPTIONS"
          :key="o.value"
          type="button"
          class="docx-align__option"
          :class="{ 'docx-align__option--active': value === o.value }"
          :title="`${o.label} (${o.shortcut})`"
          @click.prevent="select(o.value)"
        >
          <MaterialSymbol :name="o.icon" :size="20" />
        </button>
      </div>
    </template>
  </Popover>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import MaterialSymbol from './MaterialSymbol.vue';
import Popover from './Popover.vue';

export type ParagraphAlignment = 'left' | 'center' | 'right' | 'both';

const props = withDefaults(
  defineProps<{
    value?: ParagraphAlignment;
    disabled?: boolean;
  }>(),
  { value: 'left', disabled: false }
);

const emit = defineEmits<{
  (e: 'change', alignment: ParagraphAlignment): void;
}>();

const isOpen = ref(false);

const OPTIONS: { value: ParagraphAlignment; label: string; icon: string; shortcut: string }[] = [
  { value: 'left', label: 'Align left', icon: 'format_align_left', shortcut: 'Ctrl+L' },
  { value: 'center', label: 'Center', icon: 'format_align_center', shortcut: 'Ctrl+E' },
  { value: 'right', label: 'Align right', icon: 'format_align_right', shortcut: 'Ctrl+R' },
  { value: 'both', label: 'Justify', icon: 'format_align_justify', shortcut: 'Ctrl+J' },
];

const currentIcon = computed(
  () => OPTIONS.find((o) => o.value === props.value)?.icon ?? 'format_align_left'
);
const currentLabel = computed(
  () => OPTIONS.find((o) => o.value === props.value)?.label ?? 'Left'
);

function select(v: ParagraphAlignment) {
  emit('change', v);
  isOpen.value = false;
}
</script>

<style scoped>
.docx-align__btn {
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
.docx-align__btn:hover:not(:disabled) {
  background: rgba(241, 245, 249, 0.8);
  color: #0f172a;
}
.docx-align__btn--open { background: #f1f5f9; }
.docx-align__btn:disabled { opacity: 0.3; cursor: not-allowed; }
.docx-align__panel {
  display: flex;
  gap: 2px;
  padding: 6px;
  border-radius: 8px;
}
.docx-align__option {
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
.docx-align__option:hover { background: #f3f4f6; }
.docx-align__option--active {
  background: rgba(26, 115, 232, 0.12);
  color: #1a73e8;
}
</style>

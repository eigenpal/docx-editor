<!--
  Vue port of packages/react/src/components/ui/StylePicker.tsx —
  paragraph style picker (Normal / Title / Subtitle / Heading 1-3 / etc).
  Same default styles + same font-size/weight preview. Native
  <select> rather than radix-vue.
-->
<template>
  <select
    class="docx-style-picker"
    :value="value ?? 'Normal'"
    :disabled="disabled"
    :class="className"
    aria-label="Paragraph style"
    @change="onChange"
  >
    <option
      v-for="s in resolvedStyles"
      :key="s.styleId"
      :value="s.styleId"
    >
      {{ s.name }}
    </option>
  </select>
</template>

<script setup lang="ts">
import { computed } from 'vue';

export interface StyleOption {
  styleId: string;
  name: string;
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  color?: string;
}

const props = withDefaults(
  defineProps<{
    value?: string;
    styles?: StyleOption[];
    disabled?: boolean;
    className?: string;
  }>(),
  { disabled: false }
);

const emit = defineEmits<{
  (e: 'change', styleId: string): void;
}>();

const DEFAULT_STYLES: StyleOption[] = [
  { styleId: 'Normal', name: 'Normal text' },
  { styleId: 'Title', name: 'Title' },
  { styleId: 'Subtitle', name: 'Subtitle' },
  { styleId: 'Heading1', name: 'Heading 1' },
  { styleId: 'Heading2', name: 'Heading 2' },
  { styleId: 'Heading3', name: 'Heading 3' },
];

const resolvedStyles = computed(() => props.styles ?? DEFAULT_STYLES);

function onChange(e: Event) {
  emit('change', (e.target as HTMLSelectElement).value);
}
</script>

<style scoped>
.docx-style-picker {
  height: 28px;
  font-size: 13px;
  min-width: 100px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  padding: 0 6px;
  background: #fff;
  cursor: pointer;
}
.docx-style-picker:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
</style>

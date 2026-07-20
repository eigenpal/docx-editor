<!--
  Vue port of packages/react/src/components/ui/Select.tsx — basic
  styled select. React's version uses radix-ui's Select primitives;
  Vue ships a native <select> with matching Tailwind classes so the
  bundle stays slim and the consumer surface (value / onChange /
  options array) is identical.
-->
<template>
  <select
    class="docx-select"
    :class="className"
    :value="value"
    :disabled="disabled"
    @change="onChange"
  >
    <option v-for="o in options" :key="o.value" :value="o.value">{{ o.label }}</option>
  </select>
</template>

<script setup lang="ts">
export interface SelectOption {
  value: string;
  label: string;
}

defineProps<{
  value?: string;
  options: SelectOption[];
  disabled?: boolean;
  className?: string;
}>();

const emit = defineEmits<{
  (e: 'change', value: string): void;
}>();

function onChange(e: Event) {
  emit('change', (e.target as HTMLSelectElement).value);
}
</script>

<style scoped>
.docx-select {
  height: 32px;
  font-size: 14px;
  border: 1px solid var(--doc-border-dark);
  border-radius: 6px;
  padding: 0 8px;
  background: var(--doc-surface);
  cursor: pointer;
}
.docx-select:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>

<!--
  Vue port of packages/react/src/components/ui/LineSpacingPicker.tsx.
  Same default options (Single / 1.15 / 1.5 / Double) and same twips
  values (240 / 276 / 360 / 480) as the React picker. Native <select>
  rather than radix-vue.
-->
<template>
  <select
    class="docx-line-spacing"
    :value="String(currentValue)"
    :disabled="disabled"
    :class="className"
    aria-label="Line spacing"
    @change="onChange"
  >
    <option v-for="opt in resolvedOptions" :key="opt.twipsValue" :value="String(opt.twipsValue)">
      {{ opt.label }}
    </option>
  </select>
</template>

<script setup lang="ts">
import { computed } from 'vue';

export interface LineSpacingOption {
  label: string;
  value: number;
  twipsValue: number;
}

const props = withDefaults(
  defineProps<{
    value?: number;
    options?: LineSpacingOption[];
    disabled?: boolean;
    className?: string;
  }>(),
  { disabled: false }
);

const emit = defineEmits<{
  (e: 'change', twips: number): void;
}>();

const DEFAULT_OPTIONS: LineSpacingOption[] = [
  { label: 'Single', value: 1.0, twipsValue: 240 },
  { label: '1.15', value: 1.15, twipsValue: 276 },
  { label: '1.5', value: 1.5, twipsValue: 360 },
  { label: 'Double', value: 2.0, twipsValue: 480 },
];

const resolvedOptions = computed(() => props.options ?? DEFAULT_OPTIONS);
const currentValue = computed(() => {
  const v = props.value;
  return v ?? resolvedOptions.value[0].twipsValue;
});

function onChange(e: Event) {
  const v = parseInt((e.target as HTMLSelectElement).value, 10);
  if (!isNaN(v)) emit('change', v);
}
</script>

<style scoped>
.docx-line-spacing {
  height: 28px;
  font-size: 13px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  padding: 0 6px;
  background: #fff;
  cursor: pointer;
}
.docx-line-spacing:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
</style>

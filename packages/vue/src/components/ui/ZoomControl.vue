<!--
  Vue port of packages/react/src/components/ui/ZoomControl.tsx —
  a small zoom-level dropdown. Same default levels (50/75/100/125/
  150/200) and same compact / regular size variants. Uses the
  native <select> element so we don't need radix-vue.
-->
<template>
  <select
    class="docx-zoom-control"
    :class="{ 'docx-zoom-control--compact': compact, [className ?? '']: !!className }"
    :value="value"
    :disabled="disabled"
    :aria-label="`Zoom: ${displayLabel}`"
    @change="onChange"
  >
    <option v-for="lvl in resolvedLevels" :key="lvl.value" :value="lvl.value">
      {{ lvl.label }}
    </option>
  </select>
</template>

<script setup lang="ts">
import { computed } from 'vue';

export interface ZoomLevel {
  value: number;
  label: string;
}

const props = withDefaults(
  defineProps<{
    value?: number;
    levels?: ZoomLevel[];
    disabled?: boolean;
    className?: string;
    compact?: boolean;
  }>(),
  { value: 1.0, disabled: false, compact: false }
);

const emit = defineEmits<{
  (e: 'change', zoom: number): void;
}>();

const DEFAULT_LEVELS: ZoomLevel[] = [
  { value: 0.5, label: '50%' },
  { value: 0.75, label: '75%' },
  { value: 1.0, label: '100%' },
  { value: 1.25, label: '125%' },
  { value: 1.5, label: '150%' },
  { value: 2.0, label: '200%' },
];

const resolvedLevels = computed(() => props.levels ?? DEFAULT_LEVELS);
const displayLabel = computed(() => {
  const match = resolvedLevels.value.find(
    (l) => Math.abs(l.value - props.value) < 0.001
  );
  return match ? match.label : `${Math.round(props.value * 100)}%`;
});

function onChange(e: Event) {
  const v = parseFloat((e.target as HTMLSelectElement).value);
  if (!isNaN(v)) emit('change', v);
}
</script>

<style scoped>
.docx-zoom-control {
  height: 32px;
  min-width: 70px;
  font-size: 14px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  padding: 0 6px;
  background: #fff;
  cursor: pointer;
}
.docx-zoom-control--compact {
  height: 28px;
  min-width: 55px;
  font-size: 12px;
}
.docx-zoom-control:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
</style>

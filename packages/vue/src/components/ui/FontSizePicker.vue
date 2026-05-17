<!--
  Vue port of packages/react/src/components/ui/FontSizePicker.tsx —
  -, editable size, +. Same default size list (8 / 9 / 10 / 11 / 12 /
  14 / 16 / 18 / 20 / 24 / 28 / 36 / 48 / 72) and same min/max
  bounds. Uses the half-points helpers from core.
-->
<template>
  <div class="docx-font-size">
    <button
      type="button"
      class="docx-font-size__btn"
      :disabled="disabled || currentValue <= minSize"
      title="Decrease font size"
      @click.prevent="handleDecrease"
    >−</button>
    <input
      class="docx-font-size__input"
      type="text"
      :value="displayValue"
      :disabled="disabled"
      :placeholder="placeholder"
      @keydown.up.prevent="handleDecrease(); $event.stopPropagation()"
      @keydown.down.prevent="handleIncrease(); $event.stopPropagation()"
      @keydown.enter.prevent="commit($event)"
      @blur="commit($event)"
    />
    <button
      type="button"
      class="docx-font-size__btn"
      :disabled="disabled || currentValue >= maxSize"
      title="Increase font size"
      @click.prevent="handleIncrease"
    >+</button>
  </div>
</template>

<script lang="ts">
// Re-exported for parity with React's FontSizePicker, which exposes these
// half-point/point unit helpers from the same module as the component.
// `<script setup>` can't carry re-exports, so they live in a plain block.
export { halfPointsToPoints, pointsToHalfPoints } from '@eigenpal/docx-editor-core/utils/units';
</script>

<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    value?: number;
    sizes?: number[];
    disabled?: boolean;
    minSize?: number;
    maxSize?: number;
    placeholder?: string;
  }>(),
  {
    disabled: false,
    minSize: 1,
    maxSize: 1638,
    placeholder: '11',
  }
);

const emit = defineEmits<{
  (e: 'change', size: number): void;
}>();

const DEFAULT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48, 72];

const resolvedSizes = computed(() => props.sizes ?? DEFAULT_SIZES);
const currentValue = computed(() => props.value ?? parseInt(props.placeholder, 10) ?? 11);
const displayValue = computed(() =>
  props.value !== undefined ? String(props.value) : props.placeholder
);

function getNext(curr: number) {
  const next = resolvedSizes.value.find((s) => s > curr);
  return next ?? Math.min(curr + 1, props.maxSize);
}
function getPrev(curr: number) {
  const prev = [...resolvedSizes.value].reverse().find((s) => s < curr);
  return prev ?? Math.max(curr - 1, props.minSize);
}

function handleDecrease() {
  if (props.disabled) return;
  emit('change', getPrev(currentValue.value));
}
function handleIncrease() {
  if (props.disabled) return;
  emit('change', getNext(currentValue.value));
}
function commit(e: Event) {
  const v = parseFloat((e.target as HTMLInputElement).value);
  if (!isNaN(v) && v >= props.minSize && v <= props.maxSize) {
    emit('change', Math.round(v * 2) / 2);
  }
}
</script>

<style scoped>
.docx-font-size {
  display: inline-flex;
  align-items: center;
  gap: 0;
}
.docx-font-size__btn {
  width: 22px;
  height: 22px;
  font-size: 14px;
  line-height: 1;
  border: 1px solid #e2e8f0;
  border-radius: 3px;
  padding: 0;
  background: #fff;
  cursor: pointer;
}
.docx-font-size__btn:hover:not(:disabled) {
  background: #f1f5f9;
}
.docx-font-size__btn:disabled {
  cursor: not-allowed;
  opacity: 0.4;
}
.docx-font-size__input {
  width: 36px;
  height: 22px;
  text-align: center;
  font-size: 13px;
  font-weight: 600;
  border: 1px solid transparent;
  border-radius: 3px;
  outline: none;
  margin: 0 2px;
}
.docx-font-size__input:focus {
  border-color: #1a73e8;
}
</style>

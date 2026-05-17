<template>
  <button
    class="print-btn"
    :disabled="disabled"
    :title="label"
    @mousedown.prevent="handlePrint"
  >
    {{ compact ? '' : label }}
    <span v-if="compact" class="print-btn__icon">&#x1F5A8;</span>
  </button>
</template>

<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    disabled?: boolean;
    label?: string;
    compact?: boolean;
  }>(),
  {
    disabled: false,
    label: 'Print',
    compact: false,
  }
);

const emit = defineEmits<{
  (e: 'print'): void;
}>();

function handlePrint() {
  if (props.disabled) return;
  emit('print');
  window.print();
}
</script>

<style scoped>
.print-btn {
  padding: 4px 12px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  background: #fff;
  cursor: pointer;
  font-size: 13px;
  color: #374151;
  display: flex;
  align-items: center;
  gap: 4px;
}
.print-btn:hover:not(:disabled) { background: #f3f4f6; }
.print-btn:disabled { opacity: 0.5; cursor: default; }
.print-btn__icon { font-size: 14px; }
</style>

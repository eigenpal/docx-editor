<!--
  Vue port of packages/react/src/components/ui/TableInsertButtons.tsx —
  four icon buttons: row above / row below / column left / column right.
  Same emit contract (string action). Caller handles the actual table
  mutation via prosemirror commands.
-->
<template>
  <span class="docx-table-insert">
    <button
      v-for="b in INSERT_ACTIONS"
      :key="b.action"
      type="button"
      class="docx-table-insert__btn"
      :disabled="disabled"
      :title="b.label"
      @click.prevent="emit('action', b.action)"
    >
      <MaterialSymbol :name="b.icon" :size="20" />
    </button>
  </span>
</template>

<script setup lang="ts">
import MaterialSymbol from './MaterialSymbol.vue';

export type TableAction =
  | 'addRowAbove'
  | 'addRowBelow'
  | 'addColumnLeft'
  | 'addColumnRight';

defineProps<{
  disabled?: boolean;
}>();

const emit = defineEmits<{
  (e: 'action', action: TableAction): void;
}>();

const INSERT_ACTIONS: { action: TableAction; icon: string; label: string }[] = [
  { action: 'addRowAbove', icon: 'keyboard_arrow_up', label: 'Insert row above' },
  { action: 'addRowBelow', icon: 'keyboard_arrow_down', label: 'Insert row below' },
  { action: 'addColumnLeft', icon: 'keyboard_arrow_left', label: 'Insert column left' },
  { action: 'addColumnRight', icon: 'keyboard_arrow_right', label: 'Insert column right' },
];
</script>

<style scoped>
.docx-table-insert {
  display: inline-flex;
  gap: 1px;
}
.docx-table-insert__btn {
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #64748b;
  cursor: pointer;
}
.docx-table-insert__btn:hover:not(:disabled) {
  background: rgba(241, 245, 249, 0.8);
  color: #0f172a;
}
.docx-table-insert__btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}
</style>

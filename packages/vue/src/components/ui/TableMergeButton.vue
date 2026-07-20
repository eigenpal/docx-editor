<!--
  Vue port of packages/react/src/components/ui/TableMergeButton.tsx —
  single icon button: merge or split selected cells. Emit a string
  action that the caller maps to a prosemirror command.
-->
<template>
  <button
    type="button"
    class="docx-table-merge"
    :disabled="disabled"
    :title="canSplit ? 'Split cells' : 'Merge cells'"
    @click.prevent="emit('action', canSplit ? 'splitCells' : 'mergeCells')"
  >
    <MaterialSymbol
      :name="canSplit ? 'call_split' : 'call_merge'"
      :size="20"
    />
  </button>
</template>

<script setup lang="ts">
import MaterialSymbol from './MaterialSymbol.vue';

defineProps<{
  /** True when the active cell can be split (i.e. it has colspan/rowspan > 1). */
  canSplit?: boolean;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  (e: 'action', action: 'mergeCells' | 'splitCells'): void;
}>();
</script>

<style scoped>
.docx-table-merge {
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--doc-text-muted);
  cursor: pointer;
}
.docx-table-merge:hover:not(:disabled) {
  background: var(--doc-bg-hover);
  color: var(--doc-text);
}
.docx-table-merge:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}
</style>

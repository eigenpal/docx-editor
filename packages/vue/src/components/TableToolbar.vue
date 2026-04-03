<template>
  <div v-if="isInTable" class="table-toolbar">
    <span class="table-toolbar__label">Table</span>

    <!-- Row operations -->
    <button title="Add row above" @mousedown.prevent="exec('addRowAbove')">↑+</button>
    <button title="Add row below" @mousedown.prevent="exec('addRowBelow')">↓+</button>
    <button title="Delete row" @mousedown.prevent="exec('deleteRow')">↑✕</button>

    <span class="divider" />

    <!-- Column operations -->
    <button title="Add column left" @mousedown.prevent="exec('addColumnLeft')">←+</button>
    <button title="Add column right" @mousedown.prevent="exec('addColumnRight')">→+</button>
    <button title="Delete column" @mousedown.prevent="exec('deleteColumn')">→✕</button>

    <span class="divider" />

    <!-- Merge/Split -->
    <button title="Merge cells" @mousedown.prevent="exec('mergeCells')">⊞</button>
    <button title="Split cell" @mousedown.prevent="exec('splitCell')">⊟</button>

    <span class="divider" />

    <!-- Delete table -->
    <button title="Delete table" class="danger" @mousedown.prevent="exec('deleteTable')">🗑 Table</button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { EditorView } from 'prosemirror-view';

const props = defineProps<{
  view: EditorView | null;
  getCommands: () => Record<string, (...args: any[]) => any>;
  stateTick: number;
}>();

const isInTable = computed(() => {
  void props.stateTick;
  const v = props.view;
  if (!v) return false;
  const { $from } = v.state.selection;
  // Walk up from cursor to check if we're inside a table node
  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.node(depth).type.name === 'table') return true;
  }
  return false;
});

function exec(name: string) {
  const v = props.view;
  if (!v) return;
  const cmds = props.getCommands();
  const cmdFactory = cmds[name];
  if (!cmdFactory) return;
  const command = cmdFactory();
  command(v.state, (tr: any) => v.dispatch(tr), v);
  v.focus();
}
</script>

<style scoped>
.table-toolbar {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px 8px;
  background: #f0f9ff;
  border-bottom: 1px solid #bae6fd;
  font-size: 12px;
}
.table-toolbar__label {
  font-weight: 600;
  color: #0369a1;
  font-size: 11px;
  margin-right: 6px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.table-toolbar button {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 28px;
  height: 26px;
  border: none;
  border-radius: 4px;
  background: transparent;
  cursor: pointer;
  font-size: 12px;
  color: #334155;
  padding: 0 6px;
  white-space: nowrap;
}
.table-toolbar button:hover { background: #e0f2fe; }
.table-toolbar button.danger { color: #dc2626; }
.table-toolbar button.danger:hover { background: #fef2f2; }
.divider {
  width: 1px;
  height: 18px;
  background: #bae6fd;
  margin: 0 2px;
}
</style>

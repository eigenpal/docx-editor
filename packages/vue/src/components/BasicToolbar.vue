<template>
  <div class="basic-toolbar" v-if="view">
    <button
      title="Bold (Ctrl+B)"
      :class="{ active: isMarkActive('bold') }"
      @mousedown.prevent="execCommand(toggleBold)"
    >B</button>
    <button
      title="Italic (Ctrl+I)"
      :class="{ active: isMarkActive('italic') }"
      @mousedown.prevent="execCommand(toggleItalic)"
    >I</button>
    <button
      title="Underline (Ctrl+U)"
      :class="{ active: isMarkActive('underline') }"
      @mousedown.prevent="execCommand(toggleUnderline)"
    >U</button>
    <span class="divider" />
    <button title="Align Left" @mousedown.prevent="execCommand(setAlignment('left'))">⇤</button>
    <button title="Align Center" @mousedown.prevent="execCommand(setAlignment('center'))">⇔</button>
    <button title="Align Right" @mousedown.prevent="execCommand(setAlignment('right'))">⇥</button>
  </div>
</template>

<script setup lang="ts">
import type { EditorView } from 'prosemirror-view';
import type { Command } from 'prosemirror-state';
import {
  toggleBold,
  toggleItalic,
  toggleUnderline,
} from '@eigenpal/docx-core/prosemirror/commands/formatting';
import {
  setAlignment,
} from '@eigenpal/docx-core/prosemirror/commands/paragraph';

const props = defineProps<{
  view: EditorView | null;
}>();

function execCommand(command: Command) {
  const v = props.view;
  if (!v) return;
  command(v.state, (tr) => v.dispatch(tr), v);
  v.focus();
}

function isMarkActive(markName: string): boolean {
  const v = props.view;
  if (!v) return false;
  const { from, $from, to, empty } = v.state.selection;
  const markType = v.state.schema.marks[markName];
  if (!markType) return false;
  if (empty) return !!markType.isInSet(v.state.storedMarks || $from.marks());
  let found = false;
  v.state.doc.nodesBetween(from, to, (node) => {
    if (markType.isInSet(node.marks)) found = true;
  });
  return found;
}
</script>

<style scoped>
.basic-toolbar {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px 8px;
  background: #fff;
  border-bottom: 1px solid #e2e8f0;
}
.basic-toolbar button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 4px;
  background: transparent;
  cursor: pointer;
  font-size: 14px;
  font-weight: 600;
  color: #334155;
}
.basic-toolbar button:hover { background: #f1f5f9; }
.basic-toolbar button.active { background: #e2e8f0; color: #0f172a; }
.divider {
  width: 1px;
  height: 20px;
  background: #e2e8f0;
  margin: 0 4px;
}
</style>

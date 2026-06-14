<!--
  Vue port of packages/react/src/components/ui/ListButtons.tsx.
  Bullet / numbered toggles + indent / outdent buttons. Same emit
  contract; the caller dispatches the actual prosemirror commands.
-->
<template>
  <span class="docx-list-btns">
    <button
      type="button"
      class="docx-list-btns__btn"
      :class="{ 'docx-list-btns__btn--active': listState?.isInList && listState?.type === 'bullet' }"
      :disabled="disabled"
      title="Bullet list"
      @click.prevent="$emit('bullet-list')"
    >
      <MaterialSymbol name="format_list_bulleted" :size="20" />
    </button>
    <button
      type="button"
      class="docx-list-btns__btn"
      :class="{ 'docx-list-btns__btn--active': listState?.isInList && listState?.type === 'numbered' }"
      :disabled="disabled"
      title="Numbered list"
      @click.prevent="$emit('numbered-list')"
    >
      <MaterialSymbol name="format_list_numbered" :size="20" />
    </button>
    <template v-if="showIndentButtons">
      <button
        type="button"
        class="docx-list-btns__btn"
        :disabled="disabled || !canOutdent"
        title="Decrease indent"
        @click.prevent="$emit('outdent')"
      >
        <MaterialSymbol name="format_indent_decrease" :size="20" />
      </button>
      <button
        type="button"
        class="docx-list-btns__btn"
        :disabled="disabled"
        title="Increase indent"
        @click.prevent="$emit('indent')"
      >
        <MaterialSymbol name="format_indent_increase" :size="20" />
      </button>
    </template>
  </span>
</template>

<script lang="ts">
// Re-exported for parity with React's ListButtons — consumers wiring list
// state pull these from the same module as the component. `<script setup>`
// can't carry re-exports, so they live in a plain block.
export type { ListState } from '@eigenpal/docx-editor-core/utils/listState';
export { createDefaultListState } from '@eigenpal/docx-editor-core/utils/listState';
</script>

<script setup lang="ts">
import MaterialSymbol from './MaterialSymbol.vue';
import type { ListState } from '@eigenpal/docx-editor-core/utils/listState';

withDefaults(
  defineProps<{
    listState?: ListState;
    disabled?: boolean;
    showIndentButtons?: boolean;
    canOutdent?: boolean;
  }>(),
  { disabled: false, showIndentButtons: true, canOutdent: true }
);

defineEmits<{
  (e: 'bullet-list'): void;
  (e: 'numbered-list'): void;
  (e: 'indent'): void;
  (e: 'outdent'): void;
}>();
</script>

<style scoped>
.docx-list-btns {
  display: inline-flex;
  gap: 1px;
}
.docx-list-btns__btn {
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
.docx-list-btns__btn:hover:not(:disabled) {
  background: var(--doc-bg-hover);
  color: var(--doc-text);
}
.docx-list-btns__btn--active {
  background: var(--doc-text);
  color: var(--doc-on-primary);
}
.docx-list-btns__btn--active:hover {
  background: var(--doc-text);
}
.docx-list-btns__btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}
</style>

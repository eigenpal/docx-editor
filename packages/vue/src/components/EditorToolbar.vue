<!--
  Vue alias for packages/react/src/components/EditorToolbar.tsx —
  the 2-level Google-Docs-style toolbar. React uses a compound
  component pattern (`<EditorToolbar.TitleBar />` etc.); Vue
  achieves the same composability via named slots. Default slots
  render the existing Vue toolbar primitives in the same layout.
-->
<template>
  <div class="docx-editor-toolbar">
    <slot name="title-bar">
      <div class="docx-editor-toolbar__title-row">
        <div class="docx-editor-toolbar__title-left"><slot name="title-bar-left" /></div>
        <div class="docx-editor-toolbar__title-center">
          <slot name="document-name" />
          <MenuBar v-if="showMenuBar" @action="(a: string) => $emit('menu-action', a)" />
        </div>
        <div class="docx-editor-toolbar__title-right"><slot name="title-bar-right" /></div>
      </div>
    </slot>
    <slot name="toolbar">
      <Toolbar v-bind="$attrs" />
    </slot>
  </div>
</template>

<script setup lang="ts">
import Toolbar from './Toolbar.vue';
import MenuBar from './MenuBar.vue';

defineOptions({ inheritAttrs: false });

withDefaults(
  defineProps<{
    showMenuBar?: boolean;
  }>(),
  { showMenuBar: true }
);

defineEmits<{
  (e: 'menu-action', action: string): void;
}>();
</script>

<style scoped>
/* Mirror React EditorToolbar.tsx: bg-white, shadow-sm, flex-col. */
.docx-editor-toolbar {
  display: flex;
  flex-direction: column;
  background: #fff;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
  flex-shrink: 0;
}
.docx-editor-toolbar__title-row {
  display: flex;
  align-items: stretch;
  padding: 8px 0 4px;
}
.docx-editor-toolbar__title-left {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  padding: 0 4px 0 12px;
}
.docx-editor-toolbar__title-center {
  display: flex;
  flex-direction: column;
  justify-content: center;
  flex: 1;
  min-width: 0;
  padding: 4px 0;
}
.docx-editor-toolbar__title-right {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  gap: 8px;
  padding: 0 12px;
}
</style>

<!--
  Title-bar block for DocxEditorVue — DocumentName + MenuBar centered
  between left/right chrome slots. Renders nothing when `showMenuBar`
  is false. The host SFC wraps this and the Toolbar inside the
  `__toolbar-shell` (`bg-white shadow-sm` shared background); mirroring
  React's `<TitleBar>` inside `<EditorToolbar>` arrangement.
-->
<template>
  <div v-if="showMenuBar" class="docx-editor-vue__title-bar">
    <div class="docx-editor-vue__title-bar-left">
      <component :is="renderLogo" v-if="renderLogo" />
      <slot name="title-bar-left" />
    </div>
    <div class="docx-editor-vue__title-bar-center">
      <DocumentName
        :model-value="documentName"
        :editable="documentNameEditable"
        @update:model-value="(name: string) => emit('rename', name)"
      />
      <MenuBar
        @action="(action: string) => emit('menu-action', action)"
        @insert-table="(rows: number, cols: number) => emit('insert-table', rows, cols)"
      />
    </div>
    <div class="docx-editor-vue__title-bar-right">
      <slot name="title-bar-right" />
      <component :is="renderTitleBarRight" v-if="renderTitleBarRight" />
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Component } from 'vue';
import DocumentName from './DocumentName.vue';
import MenuBar from './MenuBar.vue';

withDefaults(
  defineProps<{
    showMenuBar: boolean;
    documentName: string;
    documentNameEditable?: boolean;
    renderLogo?: Component;
    renderTitleBarRight?: Component;
  }>(),
  { documentNameEditable: true }
);

const emit = defineEmits<{
  (e: 'rename', name: string): void;
  (e: 'menu-action', action: string): void;
  (e: 'insert-table', rows: number, cols: number): void;
}>();
</script>

<template>
  <div class="preview-banner" role="status">
    <span>This is a <strong>preview deployment</strong>. The released editor lives at</span>
    <a href="https://docx-editor.dev" target="_blank" rel="noopener">docx-editor.dev ↗</a>
  </div>
  <div class="docx-editor demo-app">
    <header class="demo-titlebar">
      <BrandLogo />
      <input v-model="title" class="demo-title" aria-label="Document name" />
      <span class="demo-spacer" />
      <ExampleSwitcher current="Vue" />
    </header>
    <!-- The shared toolbar: enabled state, pressed state and values all come from the
         engine through `toolbarCommandState` — including the Suggesting pill, which the
         pro review module below is what enables. -->
    <DocxEditorToolbar :editor="editor" :t="translate" />
    <!-- PRO: `reviewModule()` from @docx-editor.dev/pro is framework-neutral, so Vue
         gets markup rendering, suggesting mode, and the review queue
         (editor.getReviewItems()) from the same registration React uses. Vue has no
         packaged review PANE yet — that chrome ships with the Vue review lane. Without
         the module this same document opens in its final-state view and the review
         controls disable with the engine's own reason. -->
    <DocxEditor
      class="demo-editor"
      :document="bytes"
      :modules="proModules"
      author="Demo Reviewer"
      @ready="onReady"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, shallowRef } from 'vue';
import { DocxEditor, DocxEditorToolbar, type Editor } from '@docx-editor.dev/vue';
import { reviewModule } from '@docx-editor.dev/pro';
import { createT, en, type TranslationKey } from '@docx-editor.dev/i18n';
import { emptyDocx } from '../../shared/demoDocument';
import BrandLogo from '../../shared/BrandLogo.vue';
import ExampleSwitcher from '../../shared/ExampleSwitcher.vue';

const tEnglish = createT(en);
const translate = (key: string): string => tEnglish(key as TranslationKey);

// One stable array: module registration is construction-time, like `author`.
const proModules = [reviewModule()];

const bytes = emptyDocx();
const title = ref('Untitled document');
const editor = shallowRef<Editor | null>(null);

function onReady(created: Editor): void {
  editor.value = created;
}
</script>

<style scoped>
.demo-app {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 34px);
}
.demo-titlebar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--doc-border-input, #e2e8f0);
}
.demo-title {
  font: inherit;
  border: 1px solid transparent;
  border-radius: 4px;
  padding: 2px 6px;
  min-width: 220px;
}
.demo-title:hover,
.demo-title:focus {
  border-color: var(--doc-border-input, #e2e8f0);
}
.demo-spacer {
  flex: 1;
}
.demo-editor {
  flex: 1;
  min-height: 0;
}
</style>

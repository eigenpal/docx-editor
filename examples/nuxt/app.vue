<template>
  <div class="docx-editor app">
    <header class="header">
      <h1 class="title">docx-editor · Nuxt module</h1>
      <input v-model="title" class="doc-title" aria-label="Document name" />
    </header>
    <!-- The shared Vue toolbar — enabled/pressed state comes from the engine.
         The Suggesting pill works because of the pro review module below. -->
    <DocxEditorToolbar :editor="editor" :t="translate" />
    <main class="main">
      <!--
        <DocxEditor> is auto-imported and registered client-only by
        @docx-editor.dev/nuxt — no import or <ClientOnly> wrapper needed.

        PRO: `:modules="[reviewModule()]"` registers comments + tracked changes
        from @docx-editor.dev/pro (the framework-neutral entry works under
        Vue/Nuxt). Without it the same document opens in its final-state view
        and the review controls disable with the engine's own reason. Vue has
        no packaged review PANE yet; the queue is reachable via
        editor.getReviewItems().
      -->
      <DocxEditor
        class="editor"
        :document="bytes"
        :modules="proModules"
        author="Demo Reviewer"
        @ready="onReady"
      />
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref, shallowRef } from 'vue';
import { DocxEditorToolbar, type Editor } from '@docx-editor.dev/vue';
import { reviewModule } from '@docx-editor.dev/pro';
import { createT, en, type TranslationKey } from '@docx-editor.dev/i18n';
import { emptyDocx } from '../shared/demoDocument';

const tEnglish = createT(en);
const translate = (key: string): string => tEnglish(key as TranslationKey);

// One stable array: module registration is construction-time, like `author`.
const proModules = [reviewModule()];

const bytes = emptyDocx();
const title = ref('Untitled document');
const editor = shallowRef<Editor | null>(null);

// The editor arrives MOUNTED: `ready` fires after the pages have painted, so
// commands and reads work right here — no second "view ready" callback.
function onReady(created: Editor): void {
  editor.value = created;
}
</script>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100vh;
}
.header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 14px;
  border-bottom: 1px solid #e2e8f0;
}
.title {
  font-size: 14px;
  font-weight: 600;
  margin: 0;
}
.doc-title {
  font: inherit;
  border: 1px solid transparent;
  border-radius: 4px;
  padding: 2px 6px;
  min-width: 220px;
}
.doc-title:hover,
.doc-title:focus {
  border-color: #e2e8f0;
}
.main {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.editor {
  flex: 1;
  min-height: 0;
}
</style>

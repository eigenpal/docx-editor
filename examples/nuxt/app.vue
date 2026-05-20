<template>
  <div class="app">
    <header class="header">
      <h1 class="title">docx-editor · Nuxt module</h1>
      <span v-if="status" class="status">{{ status }}</span>
      <label class="btn btn-primary">
        <input type="file" accept=".docx" class="file-input" @change="onFileSelect" />
        Open DOCX
      </label>
      <button class="btn" @click="onNew">New</button>
    </header>
    <main class="main">
      <!--
        <DocxEditor> is auto-imported and registered client-only by
        @eigenpal/nuxt-docx-editor — no import or <ClientOnly> wrapper needed.
      -->
      <DocxEditor
        :document="documentBuffer ? undefined : currentDocument"
        :document-buffer="documentBuffer"
        :show-toolbar="true"
        @error="onError"
      />
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { createEmptyDocument, type Document } from '@eigenpal/docx-editor-core';

const documentBuffer = ref<ArrayBuffer | undefined>(undefined);
const currentDocument = ref<Document | null>(null);
const status = ref('');

// Runs in the browser only — the editor never renders during SSR.
onMounted(async () => {
  try {
    const res = await fetch('/sample.docx');
    documentBuffer.value = await res.arrayBuffer();
  } catch {
    currentDocument.value = createEmptyDocument();
  }
});

async function onFileSelect(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  status.value = 'Loading…';
  try {
    const buffer = await file.arrayBuffer();
    currentDocument.value = null;
    documentBuffer.value = buffer;
    status.value = '';
  } catch {
    status.value = 'Error loading file';
  }
}

function onNew() {
  documentBuffer.value = undefined;
  currentDocument.value = createEmptyDocument();
  status.value = '';
}

function onError(error: Error) {
  console.error('Editor error:', error);
  status.value = `Error: ${error.message}`;
}
</script>

<style>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}
.app {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
  background: #f8fafc;
}
.header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  background: #fff;
  border-bottom: 1px solid #e2e8f0;
}
.title {
  font-size: 14px;
  font-weight: 600;
  color: #0f172a;
  margin-right: auto;
}
.btn {
  padding: 6px 12px;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  color: #334155;
}
.btn:hover {
  background: #f1f5f9;
}
.btn-primary {
  background: #0f172a;
  color: #fff;
  border-color: #0f172a;
}
.btn-primary:hover {
  background: #1e293b;
}
.file-input {
  display: none;
}
.status {
  font-size: 12px;
  color: #64748b;
  padding: 4px 8px;
  background: #f1f5f9;
  border-radius: 4px;
}
.main {
  flex: 1;
  display: flex;
  overflow: hidden;
}
</style>

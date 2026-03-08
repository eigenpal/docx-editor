<template>
  <div class="app">
    <header class="header">
      <div class="header-left">
        <h1 class="title">DOCX Editor — Vue</h1>
      </div>
      <div class="header-center">
        <span v-if="fileName" class="file-name">{{ fileName }}</span>
      </div>
      <div class="header-right">
        <label class="btn btn-primary">
          <input
            type="file"
            accept=".docx"
            @change="handleFileSelect"
            class="file-input"
          />
          Open DOCX
        </label>
        <button class="btn" @click="handleNew">New</button>
        <button class="btn" @click="handleSave">Save</button>
        <span v-if="status" class="status">{{ status }}</span>
      </div>
    </header>

    <main class="main">
      <DocxEditorVue
        ref="editorRef"
        :document-buffer="documentBuffer"
        :document="currentDocument"
        :show-toolbar="true"
        @change="handleDocumentChange"
        @error="handleError"
        @ready="handleReady"
      />
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { DocxEditorVue } from '@eigenpal/docx-editor-vue';
import { createEmptyDocument } from '@eigenpal/docx-core';
import type { Document } from '@eigenpal/docx-core/types/document';

const editorRef = ref<InstanceType<typeof DocxEditorVue> | null>(null);
const documentBuffer = ref<ArrayBuffer | null>(null);
const currentDocument = ref<Document | null>(null);
const fileName = ref('sample.docx');
const status = ref('');

// Load sample document on mount
onMounted(async () => {
  try {
    const res = await fetch('/sample.docx');
    const buffer = await res.arrayBuffer();
    documentBuffer.value = buffer;
    fileName.value = 'sample.docx';
  } catch {
    currentDocument.value = createEmptyDocument();
    fileName.value = 'Untitled.docx';
  }
});

function handleFileSelect(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;

  status.value = 'Loading...';
  file.arrayBuffer().then((buffer) => {
    currentDocument.value = null;
    documentBuffer.value = buffer;
    fileName.value = file.name;
    status.value = '';
  }).catch(() => {
    status.value = 'Error loading file';
  });
}

function handleNew() {
  documentBuffer.value = null;
  currentDocument.value = createEmptyDocument();
  fileName.value = 'Untitled.docx';
  status.value = '';
}

async function handleSave() {
  if (!editorRef.value) return;

  try {
    status.value = 'Saving...';
    const blob = await editorRef.value.save();
    if (blob) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName.value || 'document.docx';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      status.value = 'Saved!';
      setTimeout(() => { status.value = ''; }, 2000);
    }
  } catch {
    status.value = 'Save failed';
  }
}

function handleDocumentChange(_doc: Document) {
  // no-op — could track dirty state here
}

function handleError(error: Error) {
  console.error('Editor error:', error);
  status.value = `Error: ${error.message}`;
}

function handleReady() {
  console.log('Editor ready');
}
</script>

<style>
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
  padding: 8px 16px;
  gap: 12px;
  background: #fff;
  border-bottom: 1px solid #e2e8f0;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.title {
  font-size: 14px;
  font-weight: 600;
  color: #0f172a;
  margin: 0;
}

.header-center {
  flex: 1;
  display: flex;
  justify-content: center;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.file-name {
  font-size: 13px;
  color: #64748b;
  padding: 4px 10px;
  background: #f1f5f9;
  border-radius: 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 200px;
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
  white-space: nowrap;
}

.btn:hover {
  background: #f1f5f9;
}

.btn-primary {
  background: #0f172a;
  color: #fff;
  border-color: #0f172a;
  cursor: pointer;
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

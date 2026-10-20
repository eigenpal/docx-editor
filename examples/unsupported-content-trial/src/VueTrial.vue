<script setup lang="ts">
import { ref } from 'vue';
import { DocxEditor, type DocxEditorRef } from '@docx-editor.dev/vue';
import GraphicCard from './GraphicCard.vue';
import {
  drawingMatch,
  approvalMatch,
  referenceMatch,
  approvalLayout,
  referenceLayout,
} from './rules';
import { sourceField } from './rules';
defineProps<{ bytes: Uint8Array }>();
const editor = ref<DocxEditorRef | null>(null);
const registered = ref(true);
const custom = ref(true);
const zoom = ref(1);
async function save() {
  const bytes = await editor.value?.save();
  if (!bytes) return;
  const url = URL.createObjectURL(new Blob([bytes]));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'consumer-review.docx';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
</script>
<template>
  <main>
    <header>
      <h1>Vue approval review</h1>
      <a href="?framework=react">Open React trial</a>
      <label><input v-model="registered" type="checkbox" />Register custom XML</label>
      <label><input v-model="custom" type="checkbox" />Custom components</label>
      <button type="button" @click="zoom = zoom === 1 ? 1.1 : 1">Change zoom</button
      ><button type="button" @click="save">Save DOCX</button>
    </header>
    <div class="editor-box">
      <DocxEditor ref="editor" :document="bytes" :zoom="zoom">
        <DocxEditor.UnsupportedElement
          v-if="registered"
          :match="approvalMatch"
          :layout="approvalLayout"
        >
          <template #default="{ element }"
            ><GraphicCard v-if="custom" :element="element"
          /></template>
        </DocxEditor.UnsupportedElement>
        <DocxEditor.UnsupportedElement
          v-if="registered"
          :match="referenceMatch"
          :layout="referenceLayout"
        >
          <template #default="{ element }"
            ><span v-if="custom" class="reference-chip" :data-local-name="element.localName">{{
              sourceField(element, 'token')
            }}</span></template
          >
        </DocxEditor.UnsupportedElement>
        <DocxEditor.UnsupportedElement :match="drawingMatch">
          <template #default="{ element }"
            ><GraphicCard v-if="custom && element.drawing" :element="element"
          /></template>
        </DocxEditor.UnsupportedElement>
      </DocxEditor>
    </div>
  </main>
</template>

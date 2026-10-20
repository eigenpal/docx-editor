<script setup lang="ts">
import { ref } from 'vue';
import { DocxEditor } from '@docx-editor.dev/vue';
import GraphicCard from './GraphicCard.vue';
defineProps<{ bytes: Uint8Array }>();
const custom = ref(true);
const zoom = ref(1);
</script>
<template>
  <main>
    <header>
      <h1>Vue graphic review</h1>
      <a href="?framework=react">Open React trial</a>
      <label><input v-model="custom" type="checkbox" />Custom placeholders</label>
      <button type="button" @click="zoom = zoom === 1 ? 1.1 : 1">Change zoom</button>
    </header>
    <div class="editor-box">
      <DocxEditor :document="bytes" :zoom="zoom">
        <template #unsupportedElement="{ element }"
          ><GraphicCard v-if="custom" :element="element"
        /></template>
      </DocxEditor>
    </div>
  </main>
</template>

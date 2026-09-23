<template>
  <div class="docx-editor refresh-demo">
    <DocxEditorRoot :document="bytes" mode="edit">
      <RefreshDemoControls />
      <DocxEditorToolbar />
      <DocxEditorViewport style="flex: 1; min-height: 0"><DocxEditorContent /></DocxEditorViewport>
    </DocxEditorRoot>
  </div>
</template>
<script setup lang="ts">
import {
  DocxEditorRoot,
  DocxEditorToolbar,
  DocxEditorViewport,
  DocxEditorContent,
} from '@docx-editor.dev/vue';
import { refreshFixture } from '../../shared/refresh-demo-fixture';
import RefreshDemoControls from './RefreshDemoControls.vue';
import '../../shared/refresh-demo.css';
const bytes = refreshFixture();
</script>

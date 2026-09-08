<script setup lang="ts">
import {
  DocxEditorParagraphDialog,
  type DocxEditorParagraphDialogProps,
} from '@docx-editor.dev/vue';
const props = withDefaults(defineProps<DocxEditorParagraphDialogProps>(), { preset: true });
const Apply = DocxEditorParagraphDialog.Apply;
</script>

<template>
  <DocxEditorParagraphDialog v-bind="props">
    <Apply as-child><button class="brand-dialog-button">Save settings</button></Apply>
  </DocxEditorParagraphDialog>
</template>

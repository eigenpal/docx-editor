<script setup lang="ts">
import {
  DocxEditorTextFormFieldDialog,
  type DocxEditorTextFormFieldDialogProps,
} from '@docx-editor.dev/vue';
const props = withDefaults(defineProps<DocxEditorTextFormFieldDialogProps>(), { preset: true });
const Apply = DocxEditorTextFormFieldDialog.Apply;
</script>

<template>
  <DocxEditorTextFormFieldDialog v-bind="props">
    <Apply as-child><button class="brand-dialog-button">Save settings</button></Apply>
  </DocxEditorTextFormFieldDialog>
</template>

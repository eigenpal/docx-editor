<script setup lang="ts">
import {
  DocxEditorPageSetupDialog,
  type DocxEditorPageSetupDialogProps,
} from '@docx-editor.dev/vue';
const props = withDefaults(defineProps<DocxEditorPageSetupDialogProps>(), { preset: true });
const Apply = DocxEditorPageSetupDialog.Apply;
</script>

<template>
  <DocxEditorPageSetupDialog v-bind="props">
    <Apply as-child><button class="brand-dialog-button">Save settings</button></Apply>
  </DocxEditorPageSetupDialog>
</template>

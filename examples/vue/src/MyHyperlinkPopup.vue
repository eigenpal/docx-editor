<script setup lang="ts">
import { DocxEditorHyperLink, type HyperLinkProps } from '@docx-editor.dev/vue';
const props = withDefaults(defineProps<HyperLinkProps>(), { preset: true });
const Edit = DocxEditorHyperLink.Edit;
const Apply = DocxEditorHyperLink.Apply;
const Copy = DocxEditorHyperLink.Copy;
</script>

<template>
  <DocxEditorHyperLink v-bind="props">
    <Edit as-child><button class="brand-dialog-button">Edit link</button></Edit>
    <Apply as-child><button class="brand-dialog-button">Save link</button></Apply>
    <Copy hidden />
  </DocxEditorHyperLink>
</template>

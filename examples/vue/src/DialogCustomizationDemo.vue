<script setup lang="ts">
import { h } from 'vue';
import {
  DocxEditor,
  DocxEditorPageSetupDialog,
  DocxEditorParagraphDialog,
  DocxEditorTextFormFieldDialog,
} from '@docx-editor.dev/vue';
import type { DocxEditorDialogs } from '@docx-editor.dev/vue';
import '../../shared/dialog-customization.css';

const button = () => h('button', { class: 'brand-dialog-button' }, 'Save settings');
const dialogs: DocxEditorDialogs = {
  pageSetup: (props) =>
    h(DocxEditorPageSetupDialog, props, () =>
      h(DocxEditorPageSetupDialog.Apply, { asChild: true }, button)
    ),
  paragraph: (props) =>
    h(DocxEditorParagraphDialog, props, () =>
      h(DocxEditorParagraphDialog.Apply, { asChild: true }, button)
    ),
  textFormField: (props) =>
    h(DocxEditorTextFormFieldDialog, props, () =>
      h(DocxEditorTextFormFieldDialog.Apply, { asChild: true }, button)
    ),
};
</script>
<template>
  <main class="dialog-demo">
    <h1>Customize dialogs</h1>
    <p>Open File → Page setup or Format → Paragraph in either editor.</p>
    <div class="dialog-demo-editors">
      <DocxEditor document="blank" class="brand-indigo" :dialogs="dialogs" />
      <DocxEditor document="blank" class="brand-green" :dialogs="dialogs" />
    </div>
  </main>
</template>

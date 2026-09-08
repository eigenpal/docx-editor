<script setup lang="ts">
import { h } from 'vue';
import {
  DocxEditor,
  DocxEditorPageSetupDialog,
  DocxEditorParagraphDialog,
  DocxEditorTextFormFieldDialog,
  DocxEditorHyperLink,
} from '@docx-editor.dev/vue';
import type { DocxEditorPopups } from '@docx-editor.dev/vue';
import '../../shared/dialog-customization.css';

const button = () => h('button', { class: 'brand-dialog-button' }, 'Save settings');
const popups: DocxEditorPopups = {
  hyperlink: (props) =>
    h(DocxEditorHyperLink, props, () => [
      h(DocxEditorHyperLink.Edit, { asChild: true }, () =>
        h('button', { class: 'brand-dialog-button' }, 'Edit link')
      ),
      h(DocxEditorHyperLink.Apply, { asChild: true }, () =>
        h('button', { class: 'brand-dialog-button' }, 'Save link')
      ),
      h(DocxEditorHyperLink.Copy, { hidden: true }),
    ]),
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
    <h1>Customize popups</h1>
    <p>Open File → Page setup or Format → Paragraph. Insert a link to try custom link actions.</p>
    <div class="dialog-demo-editors">
      <DocxEditor document="blank" class="brand-indigo" :popups="popups" />
      <DocxEditor document="blank" class="brand-green" :popups="popups" />
    </div>
  </main>
</template>

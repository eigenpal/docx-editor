<script setup lang="ts">
import { DocxEditor, definePopup, type DocxEditorPopups } from '@docx-editor.dev/vue';
import MyPageSetupDialog from './MyPageSetupDialog.vue';
import MyParagraphDialog from './MyParagraphDialog.vue';
import MyTextFormFieldDialog from './MyTextFormFieldDialog.vue';
import MyHyperlinkPopup from './MyHyperlinkPopup.vue';
import '../../shared/dialog-customization.css';

const popups: DocxEditorPopups = {
  pageSetup: definePopup(MyPageSetupDialog),
  paragraph: definePopup(MyParagraphDialog),
  textFormField: definePopup(MyTextFormFieldDialog),
  hyperlink: definePopup(MyHyperlinkPopup),
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

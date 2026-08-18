import { defineComponent, h } from 'vue';
import { DocxEditorRoot } from '../editor/DocxEditorRoot';
import { DocxEditorViewport } from '../editor/DocxEditorViewport';
import { DocxEditorContent } from '../editor/DocxEditorContent';

/** Minimal sugar host — full chrome lands in a follow-up commit. */
export const DocxEditor = defineComponent({
  name: 'DocxEditor',
  setup(_, { attrs }) {
    return () =>
      h(DocxEditorRoot, attrs, {
        default: () => h(DocxEditorViewport, null, { default: () => h(DocxEditorContent) }),
      });
  },
});

export default DocxEditor;

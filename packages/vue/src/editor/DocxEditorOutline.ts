import { computed, defineComponent, h, type PropType } from 'vue';
import type { EditorSnapshot } from '@docx-editor.dev/core/contracts/editor';
import { DocumentOutline } from '../components/DocumentOutline';
import { useDocxEditor } from './context';
import { selectDocumentAbsent } from './document-presence';
import { useEditorState } from './useEditorState';

const selectSnapshot = (snapshot: EditorSnapshot) => snapshot;
const EMPTY_OUTLINE: readonly never[] = Object.freeze([]);
const NOOP = () => {};

/** Props for the context-fed outline part. @public */
export interface DocxEditorDocumentOutlineProps {
  onClose?: () => void;
  topOffset?: number;
  leftOffset?: number;
}

/** @public */
export const DocxEditorDocumentOutline = defineComponent({
  name: 'DocxEditorDocumentOutline',
  props: {
    onClose: { type: Function as PropType<() => void>, default: undefined },
    topOffset: { type: Number, default: 0 },
    leftOffset: { type: Number, default: undefined },
  },
  setup(props) {
    const editorRef = useDocxEditor();
    const snapshot = useEditorState(selectSnapshot);
    const headings = computed(() =>
      editorRef.value && !snapshot.value.isLoading ? editorRef.value.getOutline() : EMPTY_OUTLINE
    );

    const handleHeadingClick = (blockId: string) => {
      const editor = editorRef.value;
      if (!editor) return;
      editor.focus();
      const position = { paragraphId: blockId, offset: 0 };
      editor.exec({
        type: 'setSelection',
        range: { anchor: position, head: position },
      });
      editor.scrollToBlock(blockId);
    };

    return () => {
      if (selectDocumentAbsent(snapshot.value)) return null;
      return h(DocumentOutline, {
        headings: headings.value,
        onHeadingClick: handleHeadingClick,
        onClose: props.onClose ?? NOOP,
        topOffset: props.topOffset ?? 0,
        ...(props.leftOffset !== undefined ? { leftOffset: props.leftOffset } : {}),
      });
    };
  },
});

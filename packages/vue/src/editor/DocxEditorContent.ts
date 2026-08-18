import {
  defineComponent,
  h,
  onActivated,
  onDeactivated,
  onUnmounted,
  shallowRef,
  watch,
} from 'vue';
import { useDocxEditor } from './context';

/** @public */
export interface DocxEditorContentProps {
  className?: string;
}

/** @public */
export const DocxEditorContent = defineComponent({
  name: 'DocxEditorContent',
  props: {
    className: { type: String, default: undefined },
  },
  setup(props) {
    const editorRef = useDocxEditor();
    const elementRef = shallowRef<HTMLDivElement | null>(null);

    const attach = () => {
      const editor = editorRef.value;
      const el = elementRef.value;
      if (editor && el) editor.attach(el);
    };
    const detach = () => editorRef.value?.detach();

    watch(editorRef, attach, { immediate: true, flush: 'post' });
    watch(elementRef, attach, { flush: 'post' });
    onDeactivated(detach);
    onActivated(attach);
    onUnmounted(detach);

    return () =>
      h('div', { class: 'docx-content-mount' }, [
        h('div', {
          ref: elementRef,
          class: ['docx-paginated-surface', props.className].filter(Boolean).join(' '),
        }),
      ]);
  },
});

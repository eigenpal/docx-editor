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
  class?: string;
}

/** @public */
export const DocxEditorContent = defineComponent({
  name: 'DocxEditorContent',
  props: {
    class: { type: String, default: undefined },
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

    watch([editorRef, elementRef], attach, { immediate: true, flush: 'post' });
    onDeactivated(detach);
    onActivated(attach);
    onUnmounted(detach);

    return () =>
      h('div', { class: 'docx-content-mount' }, [
        h('div', {
          ref: (el: unknown) => {
            elementRef.value = el instanceof HTMLDivElement ? el : null;
            attach();
          },
          class: ['docx-paginated-surface', props.class].filter(Boolean).join(' '),
        }),
      ]);
  },
});

import {
  defineComponent,
  h,
  onActivated,
  onDeactivated,
  onUnmounted,
  shallowRef,
  watch,
} from 'vue';
import type { DocxEditorChildren } from '../docx-editor-children';
import { useDocxEditor } from './context';
import { useImageInsertOptional } from './images/ImageInsert';
import { ImageSelectionOverlay } from './images/ImageSelectionOverlay';
import { mergeHostClass } from '../lib/mergeHostClass';

/** @public */
export interface DocxEditorContentProps {
  class?: string;
  className?: string;
  children?: DocxEditorChildren;
}

/** @public */
export const DocxEditorContent = defineComponent({
  name: 'DocxEditorContent',
  props: {
    class: { type: String, default: undefined },
    className: { type: String, default: undefined },
  },
  setup(props) {
    const editorRef = useDocxEditor();
    const imageInsert = useImageInsertOptional();
    const elementRef = shallowRef<HTMLDivElement | null>(null);
    const portalRef = shallowRef<HTMLDivElement | null>(null);

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

    const onPaste = (event: ClipboardEvent) => {
      const insert = imageInsert;
      if (!insert?.isEnabled) return;
      const items = event.clipboardData;
      if (!items) return;
      const hasImage = [...items.items].some(
        (item) => item.kind === 'file' && item.type.startsWith('image/')
      );
      if (!hasImage) return;
      event.preventDefault();
      void insert.insertFromDataTransfer(items);
    };

    const onDrop = (event: DragEvent) => {
      const insert = imageInsert;
      if (!insert?.isEnabled) return;
      const transfer = event.dataTransfer;
      if (!transfer) return;
      const hasImage = [...transfer.items].some(
        (item) => item.kind === 'file' && item.type.startsWith('image/')
      );
      if (!hasImage) return;
      event.preventDefault();
      void insert.insertFromDataTransfer(transfer);
    };

    return () =>
      h(
        'div',
        {
          ref: (el: unknown) => {
            portalRef.value = el instanceof HTMLDivElement ? el : null;
          },
          class: 'docx-content-mount',
        },
        [
          h('div', {
            ref: (el: unknown) => {
              elementRef.value = el instanceof HTMLDivElement ? el : null;
            },
            class: mergeHostClass('docx-paginated-surface', props.class, props.className),
            onPaste,
            onDrop,
          }),
          editorRef.value
            ? h(ImageSelectionOverlay, {
                containerRef: elementRef,
                portalRef,
              })
            : null,
        ]
      );
  },
});

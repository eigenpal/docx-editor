import {
  defineComponent,
  h,
  onActivated,
  onDeactivated,
  onUnmounted,
  shallowRef,
  watch,
} from 'vue';
import { clipboardDropLandsText, clipboardPasteLandsContent } from '@docx-editor.dev/core/editor';
import type { DocxEditorChildren } from '../docx-editor-children';
import { useDocxEditor } from './context';
import { useImageInsertOptional } from './images/ImageInsert';
import { ImageSelectionOverlay } from './images/ImageSelectionOverlay';
import { mergeHostClass } from '../lib/mergeHostClass';

function hasImageFile(transfer: DataTransfer): boolean {
  return [...transfer.items].some((item) => item.kind === 'file' && item.type.startsWith('image/'));
}

/** @public */
export interface DocxEditorContentProps {
  class?: string;
  className?: string;
  children?: DocxEditorChildren;
}

/** @public */
export const DocxEditorContent = defineComponent({
  name: 'DocxEditorContent',
  inheritAttrs: false,
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
      if (!hasImageFile(items)) return;
      // STAND DOWN whenever the ENGINE will land content from the payload — see the
      // predicate's contract in core. Word on macOS ships a rendered PNG beside copied
      // text. Mirrors the React adapter exactly.
      if (clipboardPasteLandsContent(items)) return;
      event.preventDefault();
      void insert.insertFromDataTransfer(items);
    };

    const onDragOver = (event: DragEvent) => {
      if (!imageInsert?.isEnabled || !event.dataTransfer || !hasImageFile(event.dataTransfer)) {
        return;
      }
      event.preventDefault();
    };

    const onDrop = (event: DragEvent) => {
      const insert = imageInsert;
      if (!insert?.isEnabled) return;
      const transfer = event.dataTransfer;
      if (!transfer) return;
      if (!hasImageFile(transfer)) return;
      // Same stand-down as paste, for the drop lane's plain-text-only reality: when the
      // payload carries visible HTML text, NOT preventing the default lets the browser
      // fire `insertFromDrop`, which is the engine's only drop path. Mirrors the React
      // adapter.
      if (clipboardDropLandsText(transfer)) return;
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
            onDragover: onDragOver,
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

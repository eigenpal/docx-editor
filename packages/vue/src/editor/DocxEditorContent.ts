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

function hasImageFile(transfer: DataTransfer): boolean {
  return [...transfer.items].some((item) => item.kind === 'file' && item.type.startsWith('image/'));
}

/** Whether an image clipboard is really text plus a preview image from a word processor. */
export function engineOwnsImagePaste(transfer: DataTransfer): boolean {
  if (typeof transfer.getData !== 'function') return false;
  const html = transfer.getData('text/html') ?? '';
  if (html.includes('data-docx-fragment') || html.includes('data:image')) return true;

  const plain = transfer.getData('text/plain') ?? '';
  if (plain.length === 0) return false;
  if (html.length === 0) return true;
  // Word for Mac puts a PNG preview beside normal textual clipboard flavours. The HTML
  // contains visible text; a browser's Copy Image payload is normally only an <img>
  // (possibly wrapped in a link), so its textContent stays empty and keeps the file lane.
  if (html.length > 4 * 1024 * 1024 || typeof DOMParser === 'undefined') return true;
  try {
    return new DOMParser().parseFromString(html, 'text/html').body?.textContent?.trim().length > 0;
  } catch {
    // Plain text is still an honest fallback; prefer one text paste over text plus a preview.
    return true;
  }
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
      // Word processors can add a rendered preview image beside the real text flavours.
      // The engine owns those payloads; the file lane remains for screenshots and Copy Image.
      // Mirrors the React adapter exactly.
      if (engineOwnsImagePaste(items)) return;
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

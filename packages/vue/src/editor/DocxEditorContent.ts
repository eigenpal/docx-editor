import { UnsupportedElementRegistryContext } from './unsupported-element-registry';
import { ConfiguredEnginePopups } from './engine-popups';
import { ConfiguredPopups } from './popup-config';
import { useDialogHost } from './dialog-host';
import {
  defineComponent,
  inject,
  h,
  onActivated,
  onDeactivated,
  onUnmounted,
  shallowRef,
  watch,
} from 'vue';
import {
  clipboardPasteLandsContent,
  editorDropHandled,
  isHTMLElementNode,
  openChartPaneAt,
} from '@docx-editor.dev/core/editor';
import type { DocxEditorChildren } from '../docx-editor-children';
import { useDocxEditor, useEditorContentElement } from './context';
import { useImageInsertOptional } from './images/ImageInsert';
import { ImageSelectionOverlay } from './images/ImageSelectionOverlay';
import { mergeHostClass } from '../lib/mergeHostClass';
import { useChromeDir } from '../i18n';

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
    const dialogs = useDialogHost();
    const editorRef = useDocxEditor();
    const registry = inject(UnsupportedElementRegistryContext, null);
    const imageInsert = useImageInsertOptional();
    const elementRef = shallowRef<HTMLDivElement | null>(null);
    const portalRef = shallowRef<HTMLDivElement | null>(null);
    const chromeDir = useChromeDir();
    watch(elementRef, (element) => registry?.setContainer(element), { flush: 'post' });
    onUnmounted(() => registry?.setContainer(null));

    const contentElement = useEditorContentElement();
    const attach = () => {
      const editor = editorRef.value;
      const el = elementRef.value;
      if (!editor || !el) return;
      try {
        editor.attach(el);
      } catch (error) {
        // A crashed open is already a refusal on the snapshot, which `DocxEditorOpenFailure`
        // shows. Rethrowing here would break the editor tree, and the dialog with it.
        if (editor.snapshot().openFailure?.code !== 'open.failed') throw error;
        console.error('[docx-editor] The document failed to open.', error);
      }
      contentElement.value = el;
    };
    const detach = () => {
      editorRef.value?.detach();
      if (contentElement.value === elementRef.value) contentElement.value = null;
    };

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

    const onDrop = (event: DragEvent) => {
      // Keep unsupported file drops on the mount from navigating away from the editor.
      event.preventDefault();
      if (editorDropHandled(event) || !imageInsert) return;
      const transfer = event.dataTransfer;
      if (!transfer || !hasImageFile(transfer)) return;
      const at = editorRef.value?.positionAtPoint(event.clientX, event.clientY);
      if (!at) return;
      const selected = editorRef.value!.exec({
        type: 'setSelection',
        range: { anchor: at, head: at },
      });
      if (!selected.ok) return;
      editorRef.value!.focus();
      void imageInsert.insertFromDataTransfer(transfer, at);
    };

    // A double press on a chart opens the Chart pane, as Edit chart does.
    const onDblclick = (event: MouseEvent) => {
      const editor = editorRef.value;
      if (editor && openChartPaneAt(editor, event)) event.preventDefault();
    };

    return () =>
      h(
        'div',
        {
          ref: (el: unknown) => {
            portalRef.value =
              isHTMLElementNode(el) && el.localName === 'div' ? (el as HTMLDivElement) : null;
          },
          class: 'docx-content-mount',
        },
        [
          h('div', {
            ref: (el: unknown) => {
              elementRef.value =
                isHTMLElementNode(el) && el.localName === 'div' ? (el as HTMLDivElement) : null;
            },
            class: mergeHostClass('docx-paginated-surface', props.class, props.className),
            onPaste,
            onDrop,
            onDblclick,
          }),
          // Dialogs mount in their own element, as in the React adapter, so a right-to-left
          // provider can mirror them without touching the pages beside them.
          h('div', {
            ref: (el: unknown) => {
              if (dialogs)
                dialogs.target.value =
                  isHTMLElementNode(el) && el.localName === 'div' ? (el as HTMLDivElement) : null;
            },
            class: 'docx-dialog-mount',
            dir: chromeDir.value,
          }),
          h(ConfiguredPopups),
          h(ConfiguredEnginePopups),
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

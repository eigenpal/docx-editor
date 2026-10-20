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
  clipboardDropLandsText,
  clipboardPasteLandsContent,
  isElementNode,
  isHTMLElementNode,
} from '@docx-editor.dev/core/editor';
import type { DocxEditorChildren } from '../docx-editor-children';
import { useDocxEditor, useEditorContentElement } from './context';
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
    const dialogs = useDialogHost();
    const editorRef = useDocxEditor();
    const registry = inject(UnsupportedElementRegistryContext, null);
    const imageInsert = useImageInsertOptional();
    const elementRef = shallowRef<HTMLDivElement | null>(null);
    const portalRef = shallowRef<HTMLDivElement | null>(null);
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
      if (clipboardDropLandsText(transfer)) {
        // Only an EDITABLE target fires `insertFromDrop`. Anywhere else the browser's
        // default action for a file-carrying transfer is to NAVIGATE to the file — which
        // destroys the session — so the drop is swallowed instead of released. Resolved
        // through the nearest annotated ancestor: `isContentEditable` does not exist on
        // SVG elements (painted vector shapes). Mirrors the React adapter.
        const target = isElementNode(event.target) ? event.target : null;
        if (target?.closest('[contenteditable]')?.getAttribute('contenteditable') === 'true') {
          return;
        }
        event.preventDefault();
        return;
      }
      event.preventDefault();
      void insert.insertFromDataTransfer(transfer);
    };

    return () =>
      h(
        'div',
        {
          ref: (el: unknown) => {
            portalRef.value =
              isHTMLElementNode(el) && el.localName === 'div' ? (el as HTMLDivElement) : null;
            if (dialogs) dialogs.target.value = portalRef.value;
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
            onDragover: onDragOver,
            onDrop,
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

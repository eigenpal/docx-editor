import type { DocxEditorChildren } from '../docx-editor-children';
import { isHTMLElementNode, hostDocumentOf } from '@docx-editor.dev/core/editor';
import { renderPopup } from './popup-renderer';
import { useEditorState } from './useEditorState';
import {
  defineComponent,
  h,
  inject,
  nextTick,
  provide,
  shallowRef,
  watch,
  Teleport,
  type InjectionKey,
  type PropType,
} from 'vue';
import type { DocxEditorPopups } from './popup-config';
import type {
  TextFormFieldDialogSession,
  RevisionMarkupDialogSession,
} from '@docx-editor.dev/core/editor';
import { useDocxEditor } from './context';
import { DocxEditorPageSetupDialog } from './DocxEditorPageSetup';
import { DocxEditorParagraphDialog } from './DocxEditorParagraphDialog';
import { DocxEditorWatermarkDialog } from './DocxEditorWatermark';
import { DocxEditorBookmarkDialog } from './DocxEditorBookmark';
import { DocxEditorSplitCellDialog } from './DocxEditorSplitCell';
import { DocxEditorTextFormFieldDialog } from './DocxEditorTextFormFieldDialog';
import { DocxEditorRevisionMarkupDialog } from './DocxEditorRevisionMarkupDialog';
type DialogKind = 'pageSetup' | 'paragraph' | 'watermark' | 'bookmark' | 'splitCell';
const key: InjectionKey<ReturnType<typeof createHost>> = Symbol('docx.dialogs');
function createHost(config: () => DocxEditorPopups | undefined) {
  const target = shallowRef<HTMLElement | null>(null);
  const active = shallowRef<DialogKind | null>(null);
  const session = shallowRef<TextFormFieldDialogSession | null>(null);
  const revisionSession = shallowRef<RevisionMarkupDialogSession | null>(null);
  let opener: HTMLElement | null = null;
  const close = () => {
    active.value = null;
    session.value?.cancel();
    session.value = null;
    revisionSession.value?.cancel();
    revisionSession.value = null;
    const returnFocusTo = opener;
    opener = null;
    void nextTick(() => {
      if (!active.value && !session.value && !revisionSession.value && returnFocusTo?.isConnected)
        returnFocusTo.focus({ preventScroll: true });
    });
  };
  const open = (kind: DialogKind, focus?: HTMLElement | null) => {
    close();
    if (config()?.[kind] === false) return;
    // The focused element of the document the editor's dialogs mount in, which is a pop-out
    // window's document when the editor moved there.
    const focused = hostDocumentOf(target.value).activeElement;
    opener = focus ?? (isHTMLElementNode(focused) ? focused : null);
    active.value = kind;
  };
  return {
    target,
    active,
    session,
    revisionSession,
    open,
    close,
    get ownsPageSetup() {
      return config()?.pageSetup !== undefined;
    },
  };
}
export const useDialogHost = () => inject(key, null);
export const DialogHost = defineComponent({
  name: 'DocxDialogHost',
  props: { popups: Object as PropType<DocxEditorPopups> },
  setup(p, { slots }) {
    const host = createHost(() => p.popups);
    provide(key, host);
    watch(
      () => p.popups,
      (config) => {
        if (
          (host.active.value && config?.[host.active.value] === false) ||
          (host.session.value && config?.textFormField === false) ||
          (host.revisionSession.value && config?.revisionMarkup === false)
        )
          host.close();
      },
      { deep: true }
    );
    const editor = useDocxEditor();
    const generation = useEditorState(() => editor.value?.mountGeneration ?? 0);
    watch(generation, (value, previous) => {
      if (value !== previous) host.close();
    });
    watch(host.target, (value) => {
      if (!value) host.close();
    });
    watch(
      editor,
      (value, _old, onCleanup) => {
        host.close();
        if (!value) return;
        const dispose = value.setTextFormFieldChrome(
          {
            onRequest: (session) => {
              host.close();
              if (p.popups?.textFormField === false) {
                session.cancel();
                return;
              }
              host.session.value = session;
              session.signal.addEventListener(
                'abort',
                () => {
                  if (host.session.value === session) host.session.value = null;
                },
                { once: true }
              );
            },
          },
          { fallback: true }
        );
        onCleanup(() => {
          dispose();
          host.close();
        });
      },
      { immediate: true }
    );
    // The `bookmark` popup answers the editor's `openBookmarkDialog` request, which the Insert
    // menu row, Ctrl/Cmd+Shift+F5 and host code all send. A `false` popup registers nothing,
    // so the command reports itself disabled instead of doing nothing.
    watch(
      [editor, host.target, () => p.popups?.bookmark === false],
      ([value, target, disabled], _old, onCleanup) => {
        if (!value || !target || disabled) return;
        onCleanup(
          value.setBookmarkChrome({
            onRequest: () => {
              // A menu row closes as the dialog opens; its menu's trigger outlives it.
              const focused = hostDocumentOf(target).activeElement;
              const trigger = focused
                ?.closest('[data-menu]')
                ?.querySelector<HTMLElement>('.docx-menubar__trigger');
              host.open('bookmark', trigger ?? null);
            },
          })
        );
      },
      { immediate: true }
    );
    watch(
      [editor, host.target, () => p.popups?.revisionMarkup === false],
      ([value, target, disabled], _old, onCleanup) => {
        if (!value || (!target && !disabled)) return;
        const disposeRevision = value.setRevisionMarkupChrome(
          {
            onRequest: (session) => {
              host.close();
              if (p.popups?.revisionMarkup === false) {
                session.cancel();
                return;
              }
              host.revisionSession.value = session;
              session.signal.addEventListener(
                'abort',
                () => {
                  if (host.revisionSession.value === session) host.revisionSession.value = null;
                },
                { once: true }
              );
            },
          },
          { fallback: true }
        );
        onCleanup(() => {
          disposeRevision();
          host.revisionSession.value?.cancel();
          host.revisionSession.value = null;
        });
      },
      { immediate: true }
    );
    return () => [
      slots.default?.(),
      host.target.value
        ? h(Teleport, { to: host.target.value }, [
            host.active.value === 'pageSetup' && p.popups?.pageSetup !== false
              ? p.popups?.pageSetup
                ? renderPopup(p.popups.pageSetup, { open: true, onClose: host.close })
                : h(DocxEditorPageSetupDialog, { open: true, onClose: host.close })
              : null,
            host.active.value === 'paragraph' && p.popups?.paragraph !== false
              ? p.popups?.paragraph
                ? renderPopup(p.popups.paragraph, { open: true, onClose: host.close })
                : h(DocxEditorParagraphDialog, { open: true, onClose: host.close })
              : null,
            host.active.value === 'watermark' && p.popups?.watermark !== false
              ? p.popups?.watermark
                ? renderPopup(p.popups.watermark, { open: true, onClose: host.close })
                : h(DocxEditorWatermarkDialog, { open: true, onClose: host.close })
              : null,
            host.active.value === 'bookmark' && p.popups?.bookmark !== false
              ? p.popups?.bookmark
                ? renderPopup(p.popups.bookmark, { open: true, onClose: host.close })
                : h(DocxEditorBookmarkDialog, { open: true, onClose: host.close })
              : null,
            host.active.value === 'splitCell' && p.popups?.splitCell !== false
              ? p.popups?.splitCell
                ? renderPopup(p.popups.splitCell, { open: true, onClose: host.close })
                : h(DocxEditorSplitCellDialog, { open: true, onClose: host.close })
              : null,
            host.revisionSession.value && p.popups?.revisionMarkup !== false
              ? p.popups?.revisionMarkup
                ? renderPopup(
                    p.popups.revisionMarkup,
                    { session: host.revisionSession.value },
                    host.revisionSession.value
                  )
                : h(DocxEditorRevisionMarkupDialog, { session: host.revisionSession.value })
              : null,
            host.session.value && p.popups?.textFormField !== false
              ? p.popups?.textFormField
                ? renderPopup(
                    p.popups.textFormField,
                    { session: host.session.value },
                    host.session.value
                  )
                : h(DocxEditorTextFormFieldDialog, { session: host.session.value })
              : null,
          ])
        : null,
    ];
  },
});

/** Keep triggered popups outside menu containers that hosts can hide or clip. */
export const DialogPortal = defineComponent({
  name: 'DocxDialogPortal',
  props: {
    content: { type: Function as PropType<() => DocxEditorChildren | null>, required: true },
  },
  setup(props) {
    const host = useDialogHost();
    return () =>
      host?.target.value
        ? h(Teleport, { to: host.target.value }, [props.content()])
        : props.content();
  },
});

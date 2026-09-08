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
import type { DocxEditorChildren } from '../docx-editor-children';
import type { TextFormFieldDialogSession } from '@docx-editor.dev/core/editor';
import { useDocxEditor } from './context';
import {
  DocxEditorPageSetupDialog,
  type DocxEditorPageSetupDialogProps,
} from './DocxEditorPageSetup';
import {
  DocxEditorParagraphDialog,
  type DocxEditorParagraphDialogProps,
} from './DocxEditorParagraphDialog';
import {
  DocxEditorTextFormFieldDialog,
  type DocxEditorTextFormFieldDialogProps,
} from './DocxEditorTextFormFieldDialog';
/** Render overrides for automatically opened dialogs. @public */
export interface DocxEditorDialogs {
  pageSetup?: (props: DocxEditorPageSetupDialogProps) => DocxEditorChildren | null;
  paragraph?: (props: DocxEditorParagraphDialogProps) => DocxEditorChildren | null;
  textFormField?: (props: DocxEditorTextFormFieldDialogProps) => DocxEditorChildren | null;
}
const key: InjectionKey<ReturnType<typeof createHost>> = Symbol('docx.dialogs');
function createHost() {
  const target = shallowRef<HTMLElement | null>(null);
  const active = shallowRef<'pageSetup' | 'paragraph' | null>(null);
  const session = shallowRef<TextFormFieldDialogSession | null>(null);
  let opener: HTMLElement | null = null;
  const close = () => {
    active.value = null;
    session.value?.cancel();
    session.value = null;
    const returnFocusTo = opener;
    opener = null;
    void nextTick(() => {
      if (!active.value && !session.value && returnFocusTo?.isConnected)
        returnFocusTo.focus({ preventScroll: true });
    });
  };
  const open = (kind: 'pageSetup' | 'paragraph', focus?: HTMLElement | null) => {
    close();
    opener =
      focus ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    active.value = kind;
  };
  return { target, active, session, open, close };
}
export const useDialogHost = () => inject(key, null);
export const DialogHost = defineComponent({
  name: 'DocxDialogHost',
  props: { dialogs: Object as PropType<DocxEditorDialogs> },
  setup(p, { slots }) {
    const host = createHost();
    provide(key, host);
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
        const dispose = value.setTextFormFieldChrome({
          onRequest: (session) => {
            host.close();
            host.session.value = session;
            session.signal.addEventListener(
              'abort',
              () => {
                if (host.session.value === session) host.session.value = null;
              },
              { once: true }
            );
          },
        });
        onCleanup(() => {
          dispose();
          host.close();
        });
      },
      { immediate: true }
    );
    return () => [
      slots.default?.(),
      host.target.value
        ? h(Teleport, { to: host.target.value }, [
            host.active.value === 'pageSetup'
              ? p.dialogs?.pageSetup
                ? p.dialogs.pageSetup({ open: true, onClose: host.close })
                : h(DocxEditorPageSetupDialog, { open: true, onClose: host.close })
              : null,
            host.active.value === 'paragraph'
              ? p.dialogs?.paragraph
                ? p.dialogs.paragraph({ open: true, onClose: host.close })
                : h(DocxEditorParagraphDialog, { open: true, onClose: host.close })
              : null,
            host.session.value
              ? p.dialogs?.textFormField
                ? p.dialogs.textFormField({ session: host.session.value })
                : h(DocxEditorTextFormFieldDialog, { session: host.session.value })
              : null,
          ])
        : null,
    ];
  },
});

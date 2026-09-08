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
import type { TextFormFieldDialogSession } from '@docx-editor.dev/core/editor';
import { useDocxEditor } from './context';
import { DocxEditorPageSetupDialog } from './DocxEditorPageSetup';
import { DocxEditorParagraphDialog } from './DocxEditorParagraphDialog';
import { DocxEditorTextFormFieldDialog } from './DocxEditorTextFormFieldDialog';
const key: InjectionKey<ReturnType<typeof createHost>> = Symbol('docx.dialogs');
function createHost(config: () => DocxEditorPopups | undefined) {
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
    if (config()?.[kind] === false) return;
    opener =
      focus ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    active.value = kind;
  };
  return {
    target,
    active,
    session,
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
          (host.session.value && config?.textFormField === false)
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
    return () => [
      slots.default?.(),
      host.target.value
        ? h(Teleport, { to: host.target.value }, [
            host.active.value === 'pageSetup' && p.popups?.pageSetup !== false
              ? p.popups?.pageSetup
                ? p.popups.pageSetup({ open: true, onClose: host.close })
                : h(DocxEditorPageSetupDialog, { open: true, onClose: host.close })
              : null,
            host.active.value === 'paragraph' && p.popups?.paragraph !== false
              ? p.popups?.paragraph
                ? p.popups.paragraph({ open: true, onClose: host.close })
                : h(DocxEditorParagraphDialog, { open: true, onClose: host.close })
              : null,
            host.session.value && p.popups?.textFormField !== false
              ? p.popups?.textFormField
                ? p.popups.textFormField({ session: host.session.value })
                : h(DocxEditorTextFormFieldDialog, { session: host.session.value })
              : null,
          ])
        : null,
    ];
  },
});

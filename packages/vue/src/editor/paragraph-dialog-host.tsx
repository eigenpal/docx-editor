// Who owns the Paragraph dialog's mount. The Vue twin of the React host.
//
// Not the control that opens it. The line-spacing part moves between the formatting bar and
// the overflow panel whenever the toolbar re-measures — a window resize, a browser zoom,
// opening devtools — and a dialog mounted inside it is unmounted with it, mid-edit, with no
// warning and nothing written. The toolbar owns it instead, OUTSIDE the element the bar
// measures, because a dialog counted among the bar's own children fed that measurement.

import { defineComponent, h, inject, provide, ref, type InjectionKey, type Ref } from 'vue';
import { DocxEditorParagraphDialog } from './DocxEditorParagraphDialog';

export interface ParagraphDialogHandle {
  /**
   * Open the dialog, naming where focus should go when it closes.
   *
   * Explicit rather than "whatever was focused": the control that opens the dialog is
   * usually a menu item, and the menu closes in the same gesture — so by the time the
   * dialog closes, the element that was focused no longer exists. Pass something that
   * outlives the menu, like the trigger the menu hangs off.
   */
  readonly open: (returnFocusTo?: HTMLElement | null) => void;
}

const PARAGRAPH_DIALOG: InjectionKey<ParagraphDialogHandle> = Symbol('docx.paragraphDialog');

/**
 * The dialog's stable home.
 *
 * Rendered once by the toolbar. A host composing its own chrome can render it anywhere that
 * outlives its trigger; `useParagraphDialog` returns null outside it, and a control that
 * cannot find a host simply renders nothing rather than mounting a dialog that will vanish.
 */
export const ParagraphDialogHost = defineComponent({
  name: 'DocxEditorParagraphDialogHost',
  setup(_props, { slots }) {
    const open = ref(false);
    const opener: Ref<HTMLElement | null> = ref(null);

    provide(PARAGRAPH_DIALOG, {
      open: (returnFocusTo?: HTMLElement | null) => {
        opener.value =
          returnFocusTo ??
          (document.activeElement instanceof HTMLElement ? document.activeElement : null);
        open.value = true;
      },
    });

    const close = (): void => {
      open.value = false;
      // Back to the control that asked for the dialog — the standard contract, and the one
      // mechanism that touches neither the document selection nor the scroll position. If it
      // has moved into the overflow panel meanwhile there is nothing to focus, and focus
      // staying put beats focusing something the user cannot see.
      const previous = opener.value;
      opener.value = null;
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };

    return () => [
      ...(slots.default?.() ?? []),
      h(DocxEditorParagraphDialog, { open: open.value, onClose: close }),
    ];
  },
});

/** The host's handle, or null when no host is above this control. */
export function useParagraphDialog(): ParagraphDialogHandle | null {
  return inject(PARAGRAPH_DIALOG, null);
}

import { watch, type Ref } from 'vue';
import { listenForPopupEscape, listenForPopupFocusLeave } from '@docx-editor.dev/core/editor';
import { useNavigationViewportElement } from '../navigation/navigation-layout';

/**
 * Close an open chrome popup on Escape through core's `listenForPopupEscape`, and when focus
 * moves outside it through `listenForPopupFocusLeave`.
 *
 * An Escape from this editor closes the popup and stops there. An Escape from a host input,
 * a host dialog, or another editor closes the popup and keeps its default behavior.
 * `close` receives `fromInside`: true when the key came from inside the popup, so focus can
 * go back to its trigger. `skip` leaves an Escape to a handler inside the popup.
 */
export function usePopupEscape(
  open: () => boolean,
  rootRef: Ref<HTMLElement | null>,
  close: (fromInside: boolean) => void,
  skip?: (event: KeyboardEvent) => boolean
): void {
  const viewport = useNavigationViewportElement();
  watch(
    () => [open(), rootRef.value] as const,
    ([isOpen, root], _, onCleanup) => {
      if (!isOpen || !root) return;
      const contains = (node: Node) => root.contains(node);
      const stopEscape = listenForPopupEscape({
        popup: root,
        contains,
        chromeRoot: () => root.closest('.docx-editor'),
        editorElements: () => [viewport.value],
        skip: (event) => skip?.(event) === true,
        close,
      });
      const stopFocus = listenForPopupFocusLeave({
        popup: root,
        contains,
        close: () => close(false),
      });
      onCleanup(() => {
        stopEscape();
        stopFocus();
      });
    },
    { flush: 'post' }
  );
}

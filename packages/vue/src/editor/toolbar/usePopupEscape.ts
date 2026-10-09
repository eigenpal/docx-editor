import { watch, type Ref } from 'vue';
import { listenForPopupEscape } from '@docx-editor.dev/core/editor';
import { useNavigationViewportElement } from '../navigation/navigation-layout';

/**
 * Close an open chrome popup on Escape through core's `listenForPopupEscape`.
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
      onCleanup(
        listenForPopupEscape({
          popup: root,
          contains: (node) => root.contains(node),
          chromeRoot: () => root.closest('.docx-editor'),
          editorElements: () => [viewport.value],
          skip: (event) => skip?.(event) === true,
          close,
        })
      );
    },
    { flush: 'post' }
  );
}

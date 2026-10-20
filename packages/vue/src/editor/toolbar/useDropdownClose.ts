import { watch, type Ref } from 'vue';
import { listenForPopupEscape, listenForPopupFocusLeave } from '@docx-editor.dev/core/editor';
import { useNavigationViewportElement } from '../navigation/navigation-layout';

/**
 * Close a toolbar dropdown on an outside press, on Escape, or when focus moves outside it.
 *
 * Escape goes through core's `listenForPopupEscape`, the one rule for every toolbar popup.
 * An Escape from this editor (the dropdown, the chrome root that holds it, the scroll
 * container, or the instance container) closes the dropdown and stops there, so the same
 * key does not also leave a header, a note, or the format painter. An Escape from host
 * content or from another editor closes the dropdown and keeps going. Focus that moves
 * outside the dropdown and outside the pages, such as to the find field, closes it too.
 * A hidden slot closes its dropdown.
 */
export function useDropdownClose(
  open: Ref<boolean>,
  setOpen: (open: boolean) => void,
  rootRef: Ref<HTMLElement | null>,
  hidden: () => boolean = () => false
): void {
  // This editor's scroll container, read at key time so it never re-binds the listeners.
  const viewport = useNavigationViewportElement();
  watch(
    () => [open.value, hidden(), rootRef.value] as const,
    ([isOpen, isHidden, root], _, onCleanup) => {
      if (isOpen && isHidden) {
        setOpen(false);
        return;
      }
      if (!isOpen || !root) return;
      const doc = root.ownerDocument;
      const contains = (node: Node) => root.contains(node);
      const onMouseDown = (event: MouseEvent) => {
        if (!event.composedPath().includes(root)) setOpen(false);
      };
      const stopEscape = listenForPopupEscape({
        popup: root,
        contains,
        chromeRoot: () => root.closest('.docx-editor'),
        editorElements: () => [viewport.value],
        close: (fromInside) => {
          setOpen(false);
          if (fromInside) root.querySelector<HTMLElement>('[aria-haspopup]')?.focus();
        },
      });
      const stopFocus = listenForPopupFocusLeave({
        popup: root,
        contains,
        close: () => setOpen(false),
      });
      doc.addEventListener('mousedown', onMouseDown);
      onCleanup(() => {
        doc.removeEventListener('mousedown', onMouseDown);
        stopEscape();
        stopFocus();
      });
    },
    { flush: 'post' }
  );
}

import { useEffect, useRef, type RefObject } from 'react';
import { editorScopeFor } from '../editor-scope';
import { useNavigationViewportElement } from '../navigation/navigation-layout';

/**
 * Whether a key event comes from this editor: the dropdown, the chrome root that holds it
 * (the toolbar or menu bar scopes itself), this editor's own scroll container with its pages,
 * or a `.docx-editor` wrapper that holds this editor's chrome and pages together.
 *
 * Never a plain ancestor: in a bare composition the host's container holds the toolbar, the
 * viewport, and the host's own inputs and dialogs side by side, and those keep their keys.
 */
function ownedByEditor(event: Event, root: HTMLElement, viewport: HTMLElement | null): boolean {
  const path = event.composedPath();
  if (path.includes(root)) return true;
  if (viewport && path.includes(viewport)) return true;
  const chrome = root.closest('.docx-editor');
  if (chrome && path.includes(chrome)) return true;
  const scope = editorScopeFor(root);
  return scope !== null && path.includes(scope);
}

/**
 * Close a toolbar dropdown on an outside press or on Escape.
 *
 * Escape is read on the owner document in the capture phase, so it reaches this listener
 * before the painted surface and before any popup handler. An Escape from inside this
 * editor closes the dropdown and stops there, so the same key does not also leave a
 * header, a note, or the format painter. An Escape from host content or from another
 * editor closes the dropdown and keeps going. A hidden slot closes its dropdown.
 */
export function useDropdownClose(
  open: boolean,
  setOpen: (open: boolean) => void,
  rootRef: RefObject<HTMLElement | null>,
  hidden = false
): void {
  // This editor's scroll container, read at key time so it never re-binds the listeners.
  const viewport = useNavigationViewportElement();
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  useEffect(() => {
    if (open && hidden) setOpen(false);
  }, [open, hidden, setOpen]);

  useEffect(() => {
    const root = rootRef.current;
    if (!open || hidden || !root) return;
    const doc = root.ownerDocument;
    const inside = (event: Event, box: Element) => event.composedPath().includes(box);
    const onMouseDown = (event: MouseEvent) => {
      if (!inside(event, root)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing || event.keyCode === 229) return;
      setOpen(false);
      if (!ownedByEditor(event, root, viewportRef.current)) return;
      event.preventDefault();
      event.stopPropagation();
      const focused = doc.activeElement;
      if (focused && root.contains(focused)) {
        root.querySelector<HTMLElement>('[aria-haspopup]')?.focus();
      }
    };
    doc.addEventListener('mousedown', onMouseDown);
    doc.addEventListener('keydown', onKeyDown, true);
    return () => {
      doc.removeEventListener('mousedown', onMouseDown);
      doc.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open, hidden, setOpen, rootRef]);
}

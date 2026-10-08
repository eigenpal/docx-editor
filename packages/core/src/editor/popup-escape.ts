// Escape for toolbar popups (pickers, the overflow panel) that open with focus left in
// the pages.
//
// Toolbar mousedown keeps the caret in the pages, so a popup opened by a click never has
// focus and its own keydown handler never hears the key. The surface, meanwhile, spends
// Escape on its transient modes (format painter, header/footer, note scope). A bubbling
// listener therefore loses the race: the first Escape leaves the mode and the popup stays.
//
// THE RULE, shared by both adapters: while the popup is open, listen on its ownerDocument
// in the CAPTURE phase. On Escape (never mid-composition), close the popup. When the key
// comes from inside this editor (the popup, the instance's `.docx-editor` container, or
// its viewport), also prevent the default and stop propagation, so the surface does not
// spend the same key on its mode. When the key comes from elsewhere (a host input, a host
// dialog, another editor), close the popup and let the key go on untouched.

/** How {@link listenForPopupEscape} decides and acts. @internal */
export interface PopupEscapeOptions {
  /** The popup's root. Its `ownerDocument` receives the listener. */
  readonly popup: HTMLElement;
  /** Whether a node belongs to the popup (its trigger, list, or a separate panel). */
  readonly contains: (node: Node) => boolean;
  /** Elements of this editor beyond its `.docx-editor` container, such as the viewport. */
  readonly editorElements?: () => readonly (Element | null | undefined)[];
  /** Return true to leave this Escape to someone else (an input that owns the key). */
  readonly skip?: (event: KeyboardEvent) => boolean;
  /** Close the popup. `fromInside` is true when the key came from inside the popup. */
  readonly close: (fromInside: boolean) => void;
}

/**
 * The nearest `.docx-editor` around `from` that holds the painted pages, or null.
 *
 * Chrome parts carry their own styling-only `docx-editor` class, so the first match from
 * a toolbar is the toolbar. The instance container is the first one with pages inside.
 *
 * @internal
 */
export function editorInstanceScope(from: Element | null): Element | null {
  let root = from?.closest('.docx-editor') ?? null;
  while (root && !root.querySelector('.docx-pages')) {
    root = root.parentElement?.closest('.docx-editor') ?? null;
  }
  return root;
}

/**
 * Close an open toolbar popup on Escape, ahead of the surface. Returns the disposer.
 *
 * Shared adapter glue, not for hosts.
 *
 * @internal
 */
export function listenForPopupEscape(options: PopupEscapeOptions): () => void {
  const owner = options.popup.ownerDocument;
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || event.isComposing || event.keyCode === 229) return;
    if (options.skip?.(event)) return;
    const target = event.target instanceof Node ? event.target : null;
    const fromInside = target !== null && options.contains(target);
    const own =
      fromInside ||
      (target !== null &&
        [editorInstanceScope(options.popup), ...(options.editorElements?.() ?? [])].some(
          (element) => element?.contains(target) === true
        ));
    options.close(fromInside);
    if (!own) return;
    event.preventDefault();
    event.stopPropagation();
  };
  owner.addEventListener('keydown', onKeyDown, true);
  return () => owner.removeEventListener('keydown', onKeyDown, true);
}

/** What an open nested popup leaves in the panel: an expanded trigger or the popup itself. */
const NESTED_POPUP = '[aria-expanded="true"], [role="menu"], [role="listbox"], [role="dialog"]';

/**
 * Whether a nested popup inside `panel` is open. Its own Escape listener closes it, and
 * the panel stays open for the next Escape.
 *
 * @internal
 */
export function hasOpenNestedPopup(panel: Element | null): boolean {
  return panel?.querySelector(NESTED_POPUP) != null;
}

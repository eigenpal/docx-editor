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
// comes from inside this editor (the popup, the chrome root that holds it, the instance's
// `.docx-editor` container, or its viewport), also prevent the default and stop
// propagation, so the surface does not spend the same key on its mode. When the key comes
// from elsewhere (a host input, a host dialog, another editor), close the popup and let the
// key go on untouched. Ownership reads the event's composed path, so a popup inside a
// shadow root still recognises its own keys.
//
// NESTED POPUPS: listeners on one node run in the order they were added, so an outer panel
// hears Escape before a dropdown opened inside it. The panel passes `skip` with
// `hasOpenNestedPopup`, the dropdown closes, and the next Escape closes the panel.
//
// FOCUS: a popup also closes when focus moves somewhere outside it and outside the pages,
// such as the find field or a host input. See `listenForPopupFocusLeave`.

/** How {@link listenForPopupEscape} decides and acts. @internal */
export interface PopupEscapeOptions {
  /** The popup's root. Its `ownerDocument` receives the listener. */
  readonly popup: HTMLElement;
  /** Whether a node belongs to the popup (its trigger, list, or a separate panel). */
  readonly contains: (node: Node) => boolean;
  /** Elements of this editor beyond its `.docx-editor` container, such as the viewport. */
  readonly editorElements?: () => readonly (Element | null | undefined)[];
  /**
   * The chrome root that holds the popup, such as the toolbar or the menu bar. It scopes
   * itself with its own `.docx-editor` class, and a key from it counts as this editor's.
   */
  readonly chromeRoot?: () => Element | null | undefined;
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
    const path = event.composedPath();
    const origin = path[0] ?? event.target;
    const target = origin instanceof Node ? origin : null;
    const fromInside = target !== null && options.contains(target);
    // A modal dialog above the popup, which the popup may have opened, owns its own Escape.
    if (!fromInside && inEditorModalDialog(target, options.popup)) return;
    const owners = [
      editorInstanceScope(options.popup),
      options.chromeRoot?.(),
      ...(options.editorElements?.() ?? []),
    ];
    const own = fromInside || owners.some((element) => element != null && path.includes(element));
    options.close(fromInside);
    if (!own) return;
    event.preventDefault();
    event.stopPropagation();
  };
  owner.addEventListener('keydown', onKeyDown, true);
  return () => owner.removeEventListener('keydown', onKeyDown, true);
}

/**
 * Whether `node` is inside a modal dialog of the editor that owns `popup`: one the editor
 * marks as its own (`data-docx-dialog` on its dialog parts, `data-docx-modal` on its other
 * modals, including native `showModal()` dialogs), or a modal inside the editor's instance
 * container. Editor dialogs may render outside the editor. A host's own modal (a component
 * library dialog elsewhere on the page) is not the editor's, so focus or Escape there still
 * closes the popup.
 */
function inEditorModalDialog(node: Node | null, popup: Element): boolean {
  const element = node instanceof Element ? node : (node?.parentElement ?? null);
  const dialog = element?.closest('[aria-modal="true"], [data-docx-modal]');
  if (!dialog) return false;
  if (dialog.hasAttribute('data-docx-dialog') || dialog.hasAttribute('data-docx-modal'))
    return true;
  return editorInstanceScope(popup)?.contains(dialog) === true;
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

/** How {@link listenForPopupFocusLeave} decides. @internal */
export interface PopupFocusLeaveOptions {
  /** The popup's root. Its `ownerDocument` receives the listener. */
  readonly popup: HTMLElement;
  /** Whether a node belongs to the popup (its trigger, list, or a separate panel). */
  readonly contains: (node: Node) => boolean;
  /** Close the popup. */
  readonly close: () => void;
}

/**
 * Close an open popup when focus moves outside it, for example to the find field after
 * Ctrl+F or to a host input. Two moves keep the popup open: focus that lands in the painted
 * pages, because a toolbar click leaves the caret there while the popup is open, and focus
 * that enters one of this editor's modal dialogs, because the popup may have opened it and
 * the dialog returns focus to its opener when it closes. A host's own modal dialog closes
 * the popup like any other control. Returns the disposer.
 *
 * @internal
 */
export function listenForPopupFocusLeave(options: PopupFocusLeaveOptions): () => void {
  const owner = options.popup.ownerDocument;
  const onFocusIn = (event: FocusEvent): void => {
    const origin = event.composedPath()[0] ?? event.target;
    if (!(origin instanceof Node) || options.contains(origin)) return;
    const element = origin instanceof Element ? origin : origin.parentElement;
    // Focus that falls to <body> moves to no control, for example while a dialog unmounts.
    if (element === null || element === owner.body || element === owner.documentElement) return;
    if (element.closest('.docx-pages') || inEditorModalDialog(element, options.popup)) return;
    options.close();
  };
  owner.addEventListener('focusin', onFocusIn, true);
  return () => owner.removeEventListener('focusin', onFocusIn, true);
}

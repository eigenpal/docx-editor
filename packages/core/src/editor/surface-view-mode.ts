// The pages layer's editable chrome.
//
// `contenteditable` / `aria-readonly` follow the host's wish AND the mode. These were two
// independent writes of one state, reconciled only by the facade calling both. A host driving
// `mountPaginatedSurface` itself and switching to viewing kept a writable pages layer — a
// blinking caret, an IME that opens on composition, and a screen reader told the document
// accepts input, on a document that refuses every write.

/**
 * Write the pages layer's editable chrome.
 *
 * Pages that are not editable still take the reader's selection, so they stay focusable. A
 * contenteditable element is focusable on its own and a plain one is not: Chromium dropped
 * focus from pages that stopped being editable, so Shift with the caret keys, Ctrl/Cmd+A and
 * Ctrl/Cmd+C never reached them.
 *
 * Each attribute is written only when it differs. A write of `contenteditable` makes the
 * browser resolve pending style at once, even with the value the element already has. A mode
 * switch that follows a paint then ran that style pass in the middle of its own work, and a
 * switch between two editable modes changes none of these attributes.
 */
export function applyPagesEditableChrome(pagesLayer: HTMLElement, editable: boolean): void {
  const contentEditable = editable ? 'true' : 'false';
  if (pagesLayer.getAttribute('contenteditable') !== contentEditable) {
    pagesLayer.contentEditable = contentEditable;
  }
  const readOnly = editable ? 'false' : 'true';
  if (pagesLayer.getAttribute('aria-readonly') !== readOnly) {
    pagesLayer.setAttribute('aria-readonly', readOnly);
  }
  if (editable) {
    if (pagesLayer.hasAttribute('tabindex')) pagesLayer.removeAttribute('tabindex');
  } else if (pagesLayer.getAttribute('tabindex') !== '0') {
    pagesLayer.tabIndex = 0;
  }
}

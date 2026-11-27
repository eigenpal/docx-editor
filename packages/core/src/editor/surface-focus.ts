// Focus for the pages layer, the one editable element that is as tall as the document.

/**
 * Focus the pages layer and keep the scroll position.
 *
 * `preventScroll` stops the scroll that reveals the focused element. The pages layer is the
 * whole document tall, so that scroll goes to its top: page 1. WebKit also restores the
 * selection that the pages layer held when focus left, and reveals that selection. A reader
 * who scrolled away from the caret was thrown back to it on the next press. With no range in
 * the pages layer at focus time, WebKit has no selection to reveal.
 *
 * Returns true when it dropped a range. The caller then owes the DOM a selection, because
 * the model still holds one.
 */
export function focusPagesLayerInPlace(pagesLayer: HTMLElement): boolean {
  const hostDocument = pagesLayer.ownerDocument;
  let dropped = false;
  if (hostDocument.activeElement !== pagesLayer) {
    const native = hostDocument.getSelection();
    if (native && native.rangeCount > 0) {
      native.removeAllRanges();
      dropped = true;
    }
  }
  pagesLayer.focus({ preventScroll: true });
  return dropped;
}

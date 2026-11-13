// Which element holds the browser's selection, for the two-way selection mirror.

/**
 * Whether these pages own the browser's selection, so that a write would take it from nobody
 * else and a selection change may be read back as theirs.
 *
 * True when focus or the selection is already inside these pages, and also when NOTHING
 * holds a selection — writing one then takes it from nobody. What this refuses is the case
 * that matters: a caret living in another element, which a repaint here would otherwise
 * yank away without an interaction.
 */
export function pagesOwnSelection(pagesLayer: HTMLElement): boolean {
  const doc = pagesLayer.ownerDocument;
  const active = doc.activeElement;
  if (active && pagesLayer.contains(active)) return true;
  // Text inputs can own focus while the document Selection is empty or still
  // points into our pages. Their native caret is not represented by that Selection.
  if (active && active !== doc.body && active !== doc.documentElement) return false;
  const domSelection = doc.getSelection();
  if (!domSelection || domSelection.rangeCount === 0) return true;
  const anchor = domSelection.anchorNode;
  if (!anchor) return true;
  // A selection anchored in a subtree that has been removed from the document belongs to
  // nobody — a surface that was torn down, or a re-rendered host. Refusing to write over
  // it would leave this surface unable to show its own caret.
  if (!anchor.isConnected) return true;
  return pagesLayer.contains(anchor);
}

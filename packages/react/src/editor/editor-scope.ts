// The editor-instance scope, distinct from the styling scope.
//
// `.ep-root` is the STYLING scope: it carries the chrome CSS variables, and since the
// composed parts self-emit it (toolbar, menu bar, context menu, navigation — like
// `Loading` and `Viewport` before them), `closest('.ep-root')` from inside a chrome part
// now matches that part's own root first. `closest()` starts at the element itself, so
// the class stopped being a proxy for "the wrapper around this whole editor instance".
//
// Code that needs the INSTANCE — the box containing both the chrome and the painted
// pages — climbs instead: past every self-scoped chrome root, to the nearest `.ep-root`
// that actually contains the pages layer. In the packaged `<DocxEditor>` that is its
// wrapper div; in a composed host it is whatever the host wrapped the parts in; a bare
// composition with no such wrapper resolves to null and callers keep their old narrow
// fallbacks.

/**
 * The nearest ancestor `.ep-root` that contains the painted pages, or null.
 *
 * Skips styling-only roots (a toolbar or menu bar's own `ep-root`) by requiring the
 * `.docx-pages` layer inside, so the answer is the editor instance's container rather
 * than the first element that happens to carry the class.
 */
export function editorScopeFor(from: Element | null): Element | null {
  let root = from?.closest('.ep-root') ?? null;
  while (root && !root.querySelector('.docx-pages')) {
    root = root.parentElement?.closest('.ep-root') ?? null;
  }
  return root;
}

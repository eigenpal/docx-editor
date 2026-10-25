// The writing direction a host page gives an element through `dir` attributes.

/**
 * The direction the nearest `dir` attribute declares for `node`, the way a browser resolves
 * it for inheritance: the value is case-insensitive, `auto` and unknown values defer to the
 * next ancestor, and the search continues from a shadow root to its host. `'ltr'` when no
 * ancestor declares one. Reading attributes forces no style pass, unlike computed style.
 *
 * @internal
 */
export function hostDirectionOf(node: Element | null): 'ltr' | 'rtl' {
  let element: Element | null = node;
  while (element) {
    const value = element.getAttribute('dir')?.toLowerCase();
    if (value === 'rtl' || value === 'ltr') return value;
    const root = element.parentElement ? null : element.getRootNode();
    element =
      element.parentElement ??
      (root && 'host' in root ? ((root as { host: Element | null }).host ?? null) : null);
  }
  return 'ltr';
}

/**
 * Call `onChange` when a `dir` attribute changes anywhere in `node`'s document, or in the
 * shadow root that holds it. Returns the cleanup.
 *
 * @internal
 */
export function observeHostDirection(node: Element, onChange: () => void): () => void {
  const view = node.ownerDocument.defaultView;
  if (!view || typeof view.MutationObserver !== 'function') return () => {};
  const observer = new view.MutationObserver(onChange);
  const options = { attributes: true, attributeFilter: ['dir'], subtree: true };
  observer.observe(node.ownerDocument.documentElement, options);
  const root = node.getRootNode();
  if (root !== node.ownerDocument) observer.observe(root, options);
  return () => observer.disconnect();
}

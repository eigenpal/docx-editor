// The widest laid-out page, which is the width of the page stack the navigation pane must
// clear. Both adapters carry an identical copy of this file.
//
// WHY NOT THE CARET'S PAGE SETUP. Every page starts at the stack's left edge and the stack is
// as wide as its widest page, so a portrait caret in a document with a landscape section
// measured the stack too narrow and let the pane cover the wider pages.
//
// WHEN IT IS READ. `getPageGeometry()` flushes any pending layout commit, so it is not read
// on every tick. It is read once when the pane opens, then once per settled burst of
// document changes (an orientation change in any section is a document change) or page-count
// steps (a progressive layout adds pages in steps). A burst settles after
// `WIDEST_PAGE_SETTLE_MS` without a new trigger.

/** Quiet time, in ms, after the last trigger before the widest page is re-read. */
export const WIDEST_PAGE_SETTLE_MS = 150;

/** What the tracker needs from the editor. */
export interface WidestPageSource {
  getPageGeometry(): readonly { readonly box: { readonly width: number } }[];
  on(event: 'change', handler: () => void): () => void;
}

/** The widest page box, in content px at 100%, or null before the first layout. */
export function widestPagePx(pages: readonly { readonly box: { readonly width: number } }[]) {
  let widest = 0;
  for (const page of pages) widest = Math.max(widest, page.box.width);
  return widest > 0 ? widest : null;
}

/** A running tracker. `nudge` schedules a settled re-read; `dispose` stops it. */
export interface WidestPageTracker {
  nudge(): void;
  dispose(): void;
}

/** Read the widest page now, then again after each settled burst of changes. */
export function trackWidestPage(
  source: WidestPageSource,
  publish: (widest: number | null) => void
): WidestPageTracker {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  const read = () => {
    timer = null;
    if (!disposed) publish(widestPagePx(source.getPageGeometry()));
  };
  const nudge = () => {
    if (disposed) return;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(read, WIDEST_PAGE_SETTLE_MS);
  };
  const offChange = source.on('change', nudge);
  read();
  return {
    nudge,
    dispose() {
      disposed = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      offChange();
    },
  };
}

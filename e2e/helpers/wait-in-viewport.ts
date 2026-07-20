/**
 * Shared Playwright wait-helpers for the paginated editor.
 *
 * Both helpers poll the DOM until a target element is rendered AND its
 * bounding rect overlaps the viewport — a stronger condition than just
 * "element exists" because virtualized content can be in the DOM but at
 * coordinates outside the visible window.
 */

import type { Page } from '@playwright/test';

function isInViewport(el: Element | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight;
}

/**
 * Wait for the painted element with `[data-doc-from="${docFrom}"]` to be in
 * the viewport. Used after scrollToPosition / scrollToParaId.
 */
export async function waitPaintedInViewport(
  page: Page,
  docFrom: number | null,
  timeout = 20000
): Promise<void> {
  await page.waitForFunction(
    (pos) => {
      if (pos == null) return false;
      const pages = document.querySelector('.paged-editor__pages');
      if (!pages) return false;
      const el = pages.querySelector(`[data-doc-from="${pos}"]`);
      const r = (el as HTMLElement | null)?.getBoundingClientRect();
      if (!r) return false;
      return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight;
    },
    docFrom,
    { timeout }
  );
}

/**
 * Wait for the Nth `.layout-page` shell (1-indexed) to be in the viewport.
 * Used after scrollToPage.
 */
export async function waitPageShellInViewport(
  page: Page,
  pageNumber: number,
  timeout = 20000
): Promise<void> {
  await page.waitForFunction(
    (n) => {
      const shells = document.querySelectorAll<HTMLElement>('.layout-page');
      const shell = shells[n - 1];
      if (!shell) return false;
      const r = shell.getBoundingClientRect();
      return r.height > 0 && r.bottom > 0 && r.top < window.innerHeight;
    },
    pageNumber,
    { timeout }
  );
}

// Re-export for tests that imported this earlier.
export { isInViewport };

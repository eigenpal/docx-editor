import type { Locator, Page } from '@playwright/test';

/**
 * Scroll through the virtualized page list until a materialized page contains
 * `marker`, and return its locator. Pages outside the viewport are empty
 * shells, so each candidate is scrolled into view and polled until it
 * materializes (paints lines) before its text is inspected.
 */
export async function findPageContaining(page: Page, marker: string): Promise<Locator> {
  const pageCount = await page.locator('.layout-page').count();
  for (let i = 0; i < pageCount; i++) {
    const el = page.locator('.layout-page').nth(i);
    await el.scrollIntoViewIfNeeded();
    // Wait for the shell to paint content (virtualization is async after the
    // scroll); a page can legitimately stay empty, so a miss is not an error.
    await page
      .waitForFunction(
        (index) => {
          const pg = document.querySelectorAll('.layout-page')[index];
          return !!pg && pg.querySelectorAll('.layout-line').length > 0;
        },
        i,
        { timeout: 3000 }
      )
      .catch(() => undefined);
    const text = await el.innerText().catch(() => '');
    if (text.includes(marker)) return el;
  }
  throw new Error(`No page containing ${JSON.stringify(marker)}`);
}

/**
 * Regression: the Vue comments-sidebar toggle stopped working after the
 * controlled `commentsSidebarOpen` prop landed. Vue casts an absent Boolean
 * prop to `false` (not `undefined`), so the editor read it as a permanently
 * controlled `false` and the toolbar toggle could never open the sidebar. The
 * fix gives the prop an explicit `undefined` default (uncontrolled), matching
 * React's absent-prop semantics.
 *
 * Run when touching: packages/vue/src/components/DocxEditor.vue (showSidebar /
 * commentsSidebarOpen), useControllableBoolean, or useOutlineSidebar's
 * handleToggleSidebar.
 */
import { test, expect, type Page } from '@playwright/test';

const SIDEBAR = '.unified-sidebar';
const TOGGLE = 'button[aria-label="Comments & Changes"]';

type SidebarGeometry = {
  pageRight: number;
  sidebarLeft: number;
  sidebarRight: number;
  wrapperRight: number;
  pagesTranslateX: number;
};

async function openSidebar(page: Page) {
  await page.locator('.docx-editor-vue').waitFor();
  await page.waitForSelector('[data-page-number]');

  const sidebar = page.locator(SIDEBAR);
  const toggle = page.locator(TOGGLE);
  if ((await sidebar.count()) === 0) {
    await toggle.click();
  }
  await expect(sidebar).toBeVisible();
}

async function readSidebarGeometry(page: Page): Promise<SidebarGeometry | null> {
  return page.evaluate(() => {
    const pageEl = document.querySelector('.layout-page');
    const sidebarEl = document.querySelector('.unified-sidebar');
    const wrapperEl = document.querySelector('.docx-editor-vue__editor-content-wrapper');
    const pagesEl = document.querySelector('.docx-editor-vue__pages');
    if (!pageEl || !sidebarEl || !wrapperEl || !pagesEl) return null;

    const pageRect = pageEl.getBoundingClientRect();
    const sidebarRect = sidebarEl.getBoundingClientRect();
    const wrapperRect = wrapperEl.getBoundingClientRect();
    const matrix = new DOMMatrixReadOnly(getComputedStyle(pagesEl).transform);
    return {
      pageRight: pageRect.right,
      sidebarLeft: sidebarRect.left,
      sidebarRight: sidebarRect.right,
      wrapperRight: wrapperRect.right,
      pagesTranslateX: matrix.m41,
    };
  });
}

test('Vue: toolbar button toggles the comments sidebar open and closed', async ({ page }) => {
  await page.goto('http://localhost:5174/?e2e=1');
  await page.locator('.docx-editor-vue').waitFor();
  await page.waitForSelector('[data-page-number]');

  const sidebar = page.locator(SIDEBAR);
  const toggle = page.locator(TOGGLE);

  // Drive to a known closed state (the demo doc has comments, so the sidebar
  // may auto-open on load).
  if (await sidebar.count()) {
    await toggle.click();
    await expect(sidebar).toHaveCount(0);
  }

  // The toggle opens it (this is what regressed — it could never open).
  await toggle.click();
  await expect(sidebar).toBeVisible();

  // And closes it again.
  await toggle.click();
  await expect(sidebar).toHaveCount(0);
});

test('Vue: comment cards sit in the reserved right sidebar gutter', async ({ page }) => {
  await page.goto('http://localhost:5174/?e2e=1');
  await openSidebar(page);

  // Opening the sidebar applies a 0.2s translateX on `.docx-editor-vue__pages`.
  // Poll until both the transform and gutter geometry have settled — a one-shot
  // read races the transition and sees the page still overlapping the sidebar.
  let settled: SidebarGeometry | null = null;
  await expect
    .poll(
      async () => {
        const first = await readSidebarGeometry(page);
        if (!first) return null;
        // One animation frame later: mid-transition translateX still moves.
        await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => r())));
        const second = await readSidebarGeometry(page);
        if (!second) return null;
        if (Math.abs(second.pagesTranslateX - first.pagesTranslateX) >= 0.5) return null;
        if (second.sidebarLeft < second.pageRight + 8) return null;
        if (second.sidebarRight > second.wrapperRight) return null;
        settled = second;
        return second;
      },
      { timeout: 5000 }
    )
    .not.toBeNull();

  expect(settled).not.toBeNull();
  expect(settled!.sidebarLeft).toBeGreaterThanOrEqual(settled!.pageRight + 8);
  expect(settled!.sidebarRight).toBeLessThanOrEqual(settled!.wrapperRight);
});

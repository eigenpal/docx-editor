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

  const geometry = await page.evaluate(() => {
    const pageEl = document.querySelector('.layout-page');
    const sidebarEl = document.querySelector('.unified-sidebar');
    const wrapperEl = document.querySelector('.docx-editor-vue__editor-content-wrapper');
    if (!pageEl || !sidebarEl || !wrapperEl) return null;

    const pageRect = pageEl.getBoundingClientRect();
    const sidebarRect = sidebarEl.getBoundingClientRect();
    const wrapperRect = wrapperEl.getBoundingClientRect();
    return {
      pageRight: pageRect.right,
      sidebarLeft: sidebarRect.left,
      sidebarRight: sidebarRect.right,
      wrapperRight: wrapperRect.right,
    };
  });

  expect(geometry).not.toBeNull();
  expect(geometry!.sidebarLeft).toBeGreaterThanOrEqual(geometry!.pageRight + 8);
  expect(geometry!.sidebarRight).toBeLessThanOrEqual(geometry!.wrapperRight);
});

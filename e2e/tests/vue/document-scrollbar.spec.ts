import { test, expect, type Page } from '@playwright/test';

async function getVueScrollbarMetrics(page: Page) {
  await page.waitForSelector('.docx-editor-vue__pages-viewport');

  return page.locator('.docx-editor-vue__pages-viewport').evaluate((el) => {
    const scroller = el as HTMLElement;
    const root = scroller.closest('.ep-root') as HTMLElement | null;
    const style = getComputedStyle(scroller);
    const scrollbar = getComputedStyle(scroller, '::-webkit-scrollbar');
    const thumb = getComputedStyle(scroller, '::-webkit-scrollbar-thumb');
    const rootStyle = root ? getComputedStyle(root) : null;

    return {
      clientHeight: scroller.clientHeight,
      scrollHeight: scroller.scrollHeight,
      overflowY: style.overflowY,
      scrollbarGutter: style.scrollbarGutter,
      scrollbarWidth: style.scrollbarWidth,
      scrollbarColor: style.scrollbarColor,
      sizeVar: rootStyle?.getPropertyValue('--doc-scrollbar-size').trim() ?? '',
      trackVar: rootStyle?.getPropertyValue('--doc-scrollbar-track').trim() ?? '',
      webkitWidth: scrollbar.width,
      webkitHeight: scrollbar.height,
      thumbBorderLeftWidth: thumb.borderLeftWidth,
      thumbBorderRadius: thumb.borderRadius,
      thumbBackgroundClip: thumb.backgroundClip,
    };
  });
}

test('Vue document scroll area uses the themeable editor scrollbar', async ({ page }) => {
  await page.goto('http://localhost:5174/?e2e=1');
  await page.waitForSelector('.docx-editor-vue__pages .layout-page', { timeout: 15000 });

  const metrics = await getVueScrollbarMetrics(page);
  const scrollbarSize = Number.parseFloat(metrics.webkitWidth || metrics.sizeVar);
  const thumbInset = Number.parseFloat(metrics.thumbBorderLeftWidth);

  expect(metrics.overflowY).toBe('auto');
  expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);
  expect(metrics.scrollbarGutter).toContain('stable');
  expect(metrics.scrollbarGutter).toContain('both-edges');
  expect(metrics.scrollbarWidth).toBe('auto');
  expect(metrics.sizeVar).toBe('14px');
  expect(metrics.trackVar).toBe('transparent');
  expect(metrics.webkitWidth).toBe('14px');
  expect(metrics.webkitHeight).toBe('14px');
  expect(scrollbarSize - thumbInset * 2).toBeGreaterThanOrEqual(8);
  expect(metrics.thumbBorderLeftWidth).toBe('3px');
  expect(metrics.thumbBorderRadius).toBe('9999px');
  expect(metrics.thumbBackgroundClip).toContain('content-box');

  await page.locator('.docx-editor-vue').evaluate((el) => {
    const root = el as HTMLElement;
    root.style.setProperty('--doc-scrollbar-size', '22px');
    root.style.setProperty('--doc-scrollbar-thumb', 'rgb(10, 20, 30)');
    root.style.setProperty('--doc-scrollbar-thumb-hover', 'rgb(40, 50, 60)');
    root.style.setProperty('--doc-scrollbar-track', 'rgb(70, 80, 90)');
  });

  const overridden = await getVueScrollbarMetrics(page);

  expect(overridden.sizeVar).toBe('22px');
  expect(overridden.webkitWidth).toBe('22px');
  expect(overridden.webkitHeight).toBe('22px');
  expect(overridden.scrollbarColor).toContain('rgb(10, 20, 30)');
  expect(overridden.scrollbarColor).toContain('rgb(70, 80, 90)');
});

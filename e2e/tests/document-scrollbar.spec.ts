import { test, expect, type Page } from '@playwright/test';
import { EditorPage } from '../helpers/editor-page';

async function getScrollbarMetrics(page: Page) {
  await page.waitForSelector('.docx-editor__scroll-container');

  return page.locator('.docx-editor__scroll-container').evaluate((el) => {
    const scroller = el as HTMLElement;
    const root = scroller.closest('.ep-root') as HTMLElement | null;
    const style = getComputedStyle(scroller);
    const scrollbar = getComputedStyle(scroller, '::-webkit-scrollbar');
    const thumb = getComputedStyle(scroller, '::-webkit-scrollbar-thumb');
    const track = getComputedStyle(scroller, '::-webkit-scrollbar-track');
    const rootStyle = root ? getComputedStyle(root) : null;

    return {
      clientHeight: scroller.clientHeight,
      scrollHeight: scroller.scrollHeight,
      clientWidth: scroller.clientWidth,
      offsetWidth: scroller.offsetWidth,
      overflowY: style.overflowY,
      scrollbarGutter: style.scrollbarGutter,
      scrollbarWidth: style.scrollbarWidth,
      scrollbarColor: style.scrollbarColor,
      docTextMuted: rootStyle?.getPropertyValue('--doc-text-muted').trim() ?? '',
      sizeVar: rootStyle?.getPropertyValue('--doc-scrollbar-size').trim() ?? '',
      thumbVar: rootStyle?.getPropertyValue('--doc-scrollbar-thumb').trim() ?? '',
      thumbHoverVar: rootStyle?.getPropertyValue('--doc-scrollbar-thumb-hover').trim() ?? '',
      trackVar: rootStyle?.getPropertyValue('--doc-scrollbar-track').trim() ?? '',
      webkitWidth: scrollbar.width,
      webkitHeight: scrollbar.height,
      thumbBackground: thumb.backgroundColor,
      thumbBorderLeftWidth: thumb.borderLeftWidth,
      thumbBorderRadius: thumb.borderRadius,
      thumbBackgroundClip: thumb.backgroundClip,
      trackBackground: track.backgroundColor,
    };
  });
}

test('document scroll area uses the themeable editor scrollbar', async ({ page }) => {
  const editor = new EditorPage(page);
  await editor.goto();
  await editor.waitForReady();
  await page.waitForSelector('.paged-editor__pages .layout-page', { timeout: 15000 });

  const metrics = await getScrollbarMetrics(page);
  const scrollbarSize = Number.parseFloat(metrics.webkitWidth || metrics.sizeVar);
  const thumbInset = Number.parseFloat(metrics.thumbBorderLeftWidth);

  expect(metrics.overflowY).toBe('auto');
  expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);
  expect(metrics.scrollbarGutter).toContain('stable');
  // `both-edges` keeps the reserved gutter symmetric so the page stays centered
  // (matches the Vue viewport).
  expect(metrics.scrollbarGutter).toContain('both-edges');
  expect(metrics.scrollbarWidth).toBe('auto');
  expect(metrics.sizeVar).toBe('14px');
  expect(metrics.thumbVar).toContain('color-mix');
  expect(metrics.thumbVar).toContain(metrics.docTextMuted);
  expect(metrics.thumbHoverVar).toContain('color-mix');
  expect(metrics.thumbHoverVar).toContain(metrics.docTextMuted);
  expect(metrics.trackVar).toBe('transparent');
  expect(metrics.webkitWidth).toBe('14px');
  expect(metrics.webkitHeight).toBe('14px');
  expect(scrollbarSize - thumbInset * 2).toBeGreaterThanOrEqual(8);
  expect(metrics.thumbBorderLeftWidth).toBe('3px');
  expect(metrics.thumbBorderRadius).toBe('9999px');
  expect(metrics.thumbBackgroundClip).toContain('content-box');

  const leftBeforeOverride = await page.locator('.paged-editor__pages').evaluate((el) => {
    return (el as HTMLElement).getBoundingClientRect().left;
  });

  await page.locator('[data-testid="docx-editor"]').evaluate((el) => {
    const root = el as HTMLElement;
    root.style.setProperty('--doc-scrollbar-size', '22px');
    root.style.setProperty('--doc-scrollbar-thumb', 'rgb(10, 20, 30)');
    root.style.setProperty('--doc-scrollbar-thumb-hover', 'rgb(40, 50, 60)');
    root.style.setProperty('--doc-scrollbar-track', 'rgb(70, 80, 90)');
  });

  const overridden = await getScrollbarMetrics(page);
  const leftAfterOverride = await page.locator('.paged-editor__pages').evaluate((el) => {
    return (el as HTMLElement).getBoundingClientRect().left;
  });

  expect(overridden.sizeVar).toBe('22px');
  expect(overridden.webkitWidth).toBe('22px');
  expect(overridden.webkitHeight).toBe('22px');
  expect(overridden.scrollbarColor).toContain('rgb(10, 20, 30)');
  expect(overridden.scrollbarColor).toContain('rgb(70, 80, 90)');
  expect(Math.abs(leftAfterOverride - leftBeforeOverride)).toBeLessThan(1);
});

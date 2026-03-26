import { test, expect } from '@playwright/test';
import { EditorPage } from '../helpers/editor-page';

test.describe('Ribbon responsiveness', () => {
  test('tabs and groups scroll horizontally on narrow widths', async ({ page }) => {
    await page.setViewportSize({ width: 640, height: 900 });
    const editor = new EditorPage(page);

    await page.goto('/?toolbar=ribbon');
    await editor.waitForReady();

    const canScroll = await page.evaluate(() => {
      const tabs = document.querySelector('.ribbon__tabs-inner') as HTMLElement | null;
      const groups = document.querySelector('.ribbon__groups-inner') as HTMLElement | null;
      if (!tabs || !groups) return { tabs: false, groups: false };

      const tabsOverflow = tabs.scrollWidth > tabs.clientWidth;
      const groupsOverflow = groups.scrollWidth > groups.clientWidth;

      tabs.scrollLeft = 0;
      groups.scrollLeft = 0;
      tabs.scrollLeft = 120;
      groups.scrollLeft = 120;

      return {
        tabs: !tabsOverflow || tabs.scrollLeft > 0,
        groups: groupsOverflow && groups.scrollLeft > 0,
      };
    });

    expect(canScroll.tabs).toBe(true);
    expect(canScroll.groups).toBe(true);
  });

  test('shows scroll controls only when overflow is present', async ({ page }) => {
    await page.setViewportSize({ width: 640, height: 900 });
    const editor = new EditorPage(page);

    await page.goto('/?toolbar=ribbon');
    await editor.waitForReady();

    const right = page.getByTestId('ribbon-groups-scroll-right');
    const left = page.getByTestId('ribbon-groups-scroll-left');

    await expect(right).toBeEnabled();
    await expect(left).toBeDisabled();

    await right.click();
    await expect(left).toBeEnabled();
  });
});

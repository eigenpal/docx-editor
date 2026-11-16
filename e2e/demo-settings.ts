import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Open the Settings tab of the demo side panel and return the panel. The panel starts closed, so
 * this opens it first if needed.
 */
export async function openDemoSettings(page: Page): Promise<Locator> {
  const panel = page.getByRole('complementary', { name: 'Side panel', exact: true });
  const show = page.getByRole('button', { name: 'Show the side panel', exact: true });
  const hide = page.getByRole('button', { name: 'Hide the side panel', exact: true });
  await expect(show.or(hide)).toBeVisible();
  if (await show.isVisible()) await show.click();
  await expect(panel).toBeVisible();
  // The panel slides in. Measure it only after the entry transition ends.
  await panel.evaluate((node) =>
    Promise.all(node.getAnimations().map((animation) => animation.finished))
  );
  const tab = panel.getByRole('tab', { name: 'Settings', exact: true });
  if ((await tab.getAttribute('aria-selected')) !== 'true') await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  return panel;
}

/**
 * Close the demo side panel with its close button, if it is open. While it is open, the review
 * rail has less room and can show as the compact strip.
 */
export async function closeDemoPanel(page: Page): Promise<void> {
  const panel = page.getByRole('complementary', { name: 'Side panel', exact: true });
  if ((await panel.count()) === 0) return;
  await panel.getByRole('button', { name: 'Close the side panel', exact: true }).click();
  await expect(panel).toHaveCount(0);
}

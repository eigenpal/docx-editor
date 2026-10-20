import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

for (const adapter of ['react', 'vue'] as const) {
  test(`${adapter}: cumulative server updates preserve scroll and expose recent changes`, async ({
    page,
  }, testInfo) => {
    const port = testInfo.config.metadata[`${adapter}Port`];
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`http://localhost:${port}/?refresh=1`);
    await expect(page.getByRole('heading', { name: 'Server updates' })).toBeVisible();
    const scroll = page.locator('.docx-editor__scroll-container');
    await expect(page.locator('.docx-page-content').first()).toBeVisible();
    await scroll.evaluate((element) => {
      element.scrollTop = 550;
    });
    const before = await scroll.evaluate((element) => element.scrollTop);
    await page.getByRole('button', { name: 'Simulate server updates' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Processing on the server' })
    ).toBeVisible();
    await expect(page.getByText('Section 25: Updated review date.', { exact: true })).toBeAttached({
      timeout: 15000,
    });
    await expect(page.getByText('1 recent change', { exact: true })).toBeVisible();
    expect(await scroll.evaluate((element) => element.scrollTop)).toBeCloseTo(before, 0);
    await expect(page.getByRole('button', { name: 'Clear highlights' })).toBeEnabled();
    await expect(page.getByRole('button', { name: /^Bold \(/ })).toBeEnabled();
    await page.getByRole('button', { name: 'Next change', exact: true }).click();
    await expect(page.getByText('Section 25: Updated review date.', { exact: true })).toBeVisible();
    const bands = page.locator('[data-docx-refresh-highlight]');
    await expect(bands).toHaveCount(1);
    const band = await bands.boundingBox();
    expect(band?.width).toBeGreaterThan(200);
    expect(band?.height).toBeGreaterThan(10);
    await mkdir('screenshots/issue-951', { recursive: true });
    await page.screenshot({ path: `screenshots/issue-951/${adapter}-recent-changes.png` });
    await page.getByRole('button', { name: 'Clear highlights' }).click();
    await expect(bands).toHaveCount(0);
  });
  test(`${adapter}: local input rejects returned files and cancellation keeps the document`, async ({
    page,
  }, testInfo) => {
    const port = testInfo.config.metadata[`${adapter}Port`];
    await page.goto(`http://localhost:${port}/?refresh=1`);
    await expect(page.locator('.docx-page-content').first()).toBeVisible();
    await page.getByRole('button', { name: 'Simulate server updates' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Processing on the server' })
    ).toBeVisible();
    await page.getByText('Section 1: Project schedule.', { exact: true }).click();
    await page.keyboard.type('LOCAL ');
    await expect(page.getByRole('status').filter({ hasText: 'Your edits are safe.' })).toBeVisible({
      timeout: 15000,
    });
    await expect(page.locator('.docx-pages')).toContainText('LOCAL');
    await page.getByRole('button', { name: 'Reset example' }).click();
    await page.getByRole('button', { name: 'Simulate server updates' }).click();
    await page.getByRole('button', { name: 'Cancel updates' }).click();
    await expect(page.getByText('Ready for updates.', { exact: true })).toBeVisible();
    await expect(page.locator('.docx-pages')).not.toContainText('Updated delivery date');
  });
}

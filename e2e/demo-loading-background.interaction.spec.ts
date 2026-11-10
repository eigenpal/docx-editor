import { expect, test } from '@playwright/test';

for (const [adapter, port] of [
  ['React', 5273],
  ['Vue', 5274],
] as const) {
  test(`${adapter} keeps its canvas color while a document loads over Slow 3G`, async ({
    page,
  }) => {
    let releaseDocument!: () => void;
    const documentGate = new Promise<void>((resolve) => {
      releaseDocument = resolve;
    });
    await page.route('**/*.docx*', async (route) => {
      await documentGate;
      await route.continue();
    });
    await page.goto(`http://localhost:${port}/`, { waitUntil: 'domcontentloaded' });
    const viewport = page.locator('.demo-viewport');
    const loading = page.locator('.docx-editor__loading--overlay');
    await expect(viewport).toBeVisible();
    await expect(loading).toBeVisible();
    await expect(loading).toHaveCSS('opacity', '1');
    const color = await viewport.evaluate((element) => getComputedStyle(element).backgroundColor);
    expect(color).not.toBe('rgba(0, 0, 0, 0)');
    await expect(page.locator('body')).toHaveCSS('background-color', color);
    await expect(loading).toHaveCSS('background-color', color);
    await expect(page.locator('.demo-dock [data-slot="insert.chart"]')).toHaveCount(0);

    // Delay document delivery after the application shell loads, then throttle its transfer.
    const network = await page.context().newCDPSession(page);
    await network.send('Network.enable');
    await network.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 2000,
      downloadThroughput: (500 * 1024) / 8,
      uploadThroughput: (500 * 1024) / 8,
      connectionType: 'cellular3g',
    });
    releaseDocument();
    await expect(viewport.locator('.docx-page').first()).toBeVisible({ timeout: 45000 });
    await expect(loading).not.toBeVisible({ timeout: 45000 });
    await expect(viewport).toHaveCSS('background-color', color);
    await expect(page.locator('.demo-dock [data-slot="insert.chart"]')).toHaveCount(0);
  });
}

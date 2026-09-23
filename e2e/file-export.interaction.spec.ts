import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { strToU8, zipSync } from 'fflate';

const source = zipSync({
  '[Content_Types].xml': strToU8(
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/></Types>'
  ),
  '_rels/.rels': strToU8(
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
  ),
  'word/document.xml': strToU8(
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>First page export text.</w:t><w:br w:type="page"/></w:r></w:p><w:p><w:r><w:t>Second page export text.</w:t></w:r></w:p></w:body></w:document>'
  ),
});

async function openSource(page: Page) {
  const chooser = page.waitForEvent('filechooser');
  await page.locator('[data-slot="file.open"]').click();
  await (
    await chooser
  ).setFiles({
    name: 'Export sample.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: Buffer.from(source),
  });
  await expect(
    page.locator('[data-paragraph-id]').filter({ hasText: 'Second page export text.' }).first()
  ).toBeVisible();
}

for (const [adapter, port] of [
  ['React', 5273],
  ['Vue', 5274],
] as const) {
  test(`${adapter} exports current document as continuous Markdown and PDF`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto(`http://localhost:${port}/`);
    const file = page.locator('[data-menu="file"] > [role="menuitem"]');
    await expect(file).toBeEnabled();
    await file.click();
    await openSource(page);
    const paragraph = page
      .locator('[data-paragraph-id]')
      .filter({ hasText: 'Second page export text.' })
      .first();
    await paragraph.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' Unsaved edit.');
    await expect(paragraph).toContainText('Unsaved edit.');

    for (const [slot, extension] of [
      ['file.exportMarkdown', 'md'],
      ['file.exportPdf', 'pdf'],
    ] as const) {
      await file.click();
      await page.getByRole('menuitem', { name: 'Export', exact: true }).hover();
      const download = page.waitForEvent('download', { timeout: 90_000 });
      const action = page.locator(`[data-slot="${slot}"]`);
      await action.focus();
      await action.press('Enter');
      const result = await download;
      await expect(page.locator('[data-docx-dialog="export"]')).toHaveCount(0);
      await expect(file).toBeFocused();
      expect(result.suggestedFilename()).toBe(`Export sample.${extension}`);
      const bytes = await readFile((await result.path())!);
      if (extension === 'md') {
        const markdown = bytes.toString('utf8');
        expect(markdown.replace(/\\\./g, '.').replace(/\s+/g, ' ').trim()).toBe(
          'First page export text. Second page export text. Unsaved edit.'
        );
        expect(markdown).not.toContain('<!--');
        expect(markdown).not.toContain('---');
      } else {
        expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
        expect(bytes.length).toBeGreaterThan(1000);
      }
      await expect(page.locator('[data-docx-dialog="export"] [role="alert"]')).toHaveCount(0);
    }
  });

  test(`${adapter} keeps export feedback visible when responsive chrome hides the menu`, async ({
    page,
  }) => {
    await page.goto(`http://localhost:${port}/`);
    await page.getByTitle('Dark mode', { exact: true }).click();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/api/convert?**', async (route) => {
      await gate;
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Conversion failed' }),
      });
    });
    try {
      await page.locator('[data-menu="file"] > [role="menuitem"]').click();
      await page.getByRole('menuitem', { name: 'Export', exact: true }).hover();
      await page.locator('[data-slot="file.exportPdf"]').click();
      const dialog = page.getByRole('dialog', { name: 'Exporting PDF…' });
      await expect(dialog).toBeVisible();
      await page.setViewportSize({ width: 375, height: 667 });
      await expect(dialog).toBeVisible();
      const bounds = await dialog.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(375);
      expect(bounds!.y).toBeGreaterThanOrEqual(0);
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(667);
      await expect(dialog.locator('.docx-export-dialog__spinner')).toHaveCSS(
        'animation-name',
        'none'
      );
      const button = dialog.getByRole('button', { name: 'Continue editing' });
      await expect(button).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(button).toBeFocused();
      await page.keyboard.press('Shift+Tab');
      await expect(button).toBeFocused();
      await page.screenshot({ path: `/tmp/docx-export-${adapter.toLowerCase()}-dark-mobile.png` });
      release();
      await expect(page.getByRole('alertdialog')).toBeVisible();
      await page.getByRole('button', { name: 'Close', exact: true }).click();
      await expect(page.getByRole('alertdialog')).toHaveCount(0);
    } finally {
      release();
    }
  });

  test(`${adapter} refuses server error pages returned as PDF bytes`, async ({ page }) => {
    await page.goto(`http://localhost:${port}/`);
    await page.route('**/api/convert?**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          pdf: Buffer.from('<!doctype html><title>Missing PDF endpoint</title>').toString('base64'),
        }),
      })
    );
    let downloads = 0;
    page.on('download', () => {
      downloads++;
    });
    await page.locator('[data-menu="file"] > [role="menuitem"]').click();
    await page.getByRole('menuitem', { name: 'Export', exact: true }).hover();
    await page.locator('[data-slot="file.exportPdf"]').click();
    await expect(page.getByRole('alertdialog')).toContainText('without a PDF header');
    expect(downloads).toBe(0);
  });

  test(`${adapter} blocks duplicate exports and recovers after server failure`, async ({
    page,
  }) => {
    await page.goto(`http://localhost:${port}/`);
    const file = page.locator('[data-menu="file"] > [role="menuitem"]');
    await file.click();
    await openSource(page);
    let requests = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/api/convert?**', async (route) => {
      requests++;
      if (requests === 1) await gate;
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Conversion server unavailable' }),
      });
    });
    await file.click();
    await page.getByRole('menuitem', { name: 'Export', exact: true }).hover();
    const menuBounds = await page.locator('[role="menubar"]').boundingBox();
    await page.locator('[data-slot="file.exportPdf"]').click();
    const progress = page.getByRole('dialog', { name: 'Exporting PDF…', exact: true });
    await expect(progress).toBeVisible();
    await expect(progress.getByRole('button', { name: 'Continue editing' })).toBeFocused();
    expect(await page.locator('[role="menubar"]').boundingBox()).toEqual(menuBounds);
    const dialogBounds = await progress.boundingBox();
    const spinnerBounds = await progress.locator('.docx-export-dialog__spinner').boundingBox();
    expect(dialogBounds).not.toBeNull();
    expect(spinnerBounds).not.toBeNull();
    expect(spinnerBounds!.x + spinnerBounds!.width / 2).toBeCloseTo(
      dialogBounds!.x + dialogBounds!.width / 2,
      0
    );
    await page.screenshot({ path: `/tmp/docx-export-${adapter.toLowerCase()}-progress.png` });
    await page.keyboard.press('Escape');
    await expect(progress).toHaveCount(0);
    await expect(file).toBeFocused();
    await expect.poll(() => requests).toBe(1);
    await file.click();
    await page.getByRole('menuitem', { name: 'Export', exact: true }).hover();
    for (const slot of ['file.exportMarkdown', 'file.exportPdf']) {
      const row = page.locator(`[data-slot="${slot}"]`);
      await expect(row).toHaveAttribute('aria-disabled', 'true');
      await row.evaluate((element: HTMLElement) => element.click());
    }
    expect(requests).toBe(1);
    release();
    const error = page.locator('[data-docx-dialog="export"] [role="alert"]');
    await expect(error).toContainText('Conversion server unavailable');
    await page.getByRole('alertdialog').getByRole('button', { name: 'Close', exact: true }).click();
    if ((await file.getAttribute('aria-expanded')) !== 'true') await file.click();
    await page.getByRole('menuitem', { name: 'Export', exact: true }).hover();
    await expect(page.locator('[data-slot="file.exportPdf"]')).not.toHaveAttribute(
      'aria-disabled',
      'true'
    );
    await page.locator('[data-slot="file.exportPdf"]').click();
    await expect.poll(() => requests).toBe(2);
    await expect(error).toContainText('Conversion server unavailable');
    await page.getByRole('alertdialog').getByRole('button', { name: 'Close', exact: true }).click();
    await file.click();
    await page.getByRole('menuitem', { name: 'Export', exact: true }).hover();
    const download = page.waitForEvent('download');
    await page.locator('[data-slot="file.exportMarkdown"]').click();
    await download;
    await expect(error).toHaveCount(0);
  });
}

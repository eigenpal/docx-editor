import { test, expect, type Page } from '@playwright/test';

// A one-page PDF with a correct cross-reference table.
function samplePdf(): string {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return body;
}

/**
 * Headless browsers show no print dialog, and Playwright's headless shell has no PDF
 * viewer. This reports a PDF viewer, points the hidden print frame at an empty page, and
 * counts print calls on that frame. Every other frame is unchanged.
 */
async function recordPrints(page: Page) {
  await page.addInitScript(() => {
    const state = window as unknown as { __prints: number; __printSource: string };
    state.__prints = 0;
    Object.defineProperty(Navigator.prototype, 'pdfViewerEnabled', { get: () => true });
    const src = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'src')!;
    Object.defineProperty(HTMLIFrameElement.prototype, 'src', {
      configurable: true,
      get: src.get,
      set(this: HTMLIFrameElement, value: string) {
        if (!this.hasAttribute('data-docx-print-frame')) return src.set!.call(this, value);
        state.__printSource = value;
        src.set!.call(this, 'about:blank');
      },
    });
    const native = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow')!;
    Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
      configurable: true,
      get(this: HTMLIFrameElement) {
        const frame = native.get!.call(this) as Window | null;
        if (!frame || !this.hasAttribute('data-docx-print-frame')) return frame;
        return { focus: () => undefined, print: () => (state.__prints += 1) };
      },
    });
  });
}

async function prints(page: Page) {
  return page.evaluate(() => (window as unknown as { __prints: number }).__prints);
}

for (const [adapter, port] of [
  ['React', 5273],
  ['Vue', 5274],
] as const) {
  test(`${adapter} prints the current document through the PDF handler`, async ({ page }) => {
    await recordPrints(page);
    let conversions = 0;
    await page.route('**/api/convert?**', async (route) => {
      conversions += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ pdf: Buffer.from(samplePdf()).toString('base64') }),
      });
    });
    await page.goto(`http://localhost:${port}/`);
    const file = page.locator('[data-menu="file"] > [role="menuitem"]');
    await expect(file).toBeEnabled();
    await file.click();
    const row = page.locator('[data-slot="file.print"]');
    await expect(row).toBeEnabled();
    await row.click();

    // The editor popup closes once the browser print dialog opens.
    await expect.poll(() => prints(page), { timeout: 30_000 }).toBe(1);
    await expect(page.locator('dialog[data-docx-dialog="print"]')).toHaveCount(0);
    await expect(file).toBeFocused();
    expect(conversions).toBe(1);
    // The frame keeps the converted PDF while the browser prints from it.
    await expect(page.locator('[data-docx-print-frame]')).toHaveCount(1);
    expect(
      await page.evaluate(() => (window as unknown as { __printSource: string }).__printSource)
    ).toMatch(/^blob:/);

    // The print shortcut starts a new print from the document.
    await page.locator('[data-paragraph-id]').first().click();
    // The page's emulated platform decides the chord, not the machine running the test.
    // It reads userAgentData first, as the editor does.
    const apple = await page.evaluate(() => {
      const agent = navigator as Navigator & { userAgentData?: { platform?: string } };
      return /mac|iphone|ipad/i.test(agent.userAgentData?.platform || navigator.platform);
    });
    await page.keyboard.press(apple ? 'Meta+p' : 'Control+p');
    await expect.poll(() => prints(page), { timeout: 30_000 }).toBe(2);
    expect(conversions).toBe(2);
    await expect(page.locator('[data-docx-print-frame]')).toHaveCount(1);
  });

  test(`${adapter} reports a failed print conversion and cancels cleanly`, async ({ page }) => {
    await recordPrints(page);
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
    await page.goto(`http://localhost:${port}/`);
    const file = page.locator('[data-menu="file"] > [role="menuitem"]');
    await file.click();
    await page.locator('[data-slot="file.print"]').click();
    const preparing = page.getByRole('dialog', { name: 'Preparing to print…' });
    await expect(preparing).toBeVisible();
    const cancel = preparing.getByRole('button', { name: 'Cancel' });
    await expect(cancel).toBeFocused();
    await cancel.click();
    await expect(preparing).toHaveCount(0);
    release();
    await page.waitForTimeout(500);
    await expect(page.locator('dialog[data-docx-dialog="print"]')).toHaveCount(0);

    await file.click();
    await page.locator('[data-slot="file.print"]').click();
    const failed = page.getByRole('alertdialog', { name: 'Print failed' });
    await expect(failed).toBeVisible();
    await expect(failed.getByRole('alert')).toContainText('Conversion failed');
    expect(await prints(page)).toBe(0);
    await failed.getByRole('button', { name: 'Close' }).click();
    await expect(failed).toHaveCount(0);
  });

  test(`${adapter} offers the PDF when the browser has no PDF viewer`, async ({ page }) => {
    // Playwright's headless shell reports no PDF viewer, like a browser with it disabled.
    const downloads: string[] = [];
    page.on('download', (download) => downloads.push(download.suggestedFilename()));
    await page.route('**/api/convert?**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ pdf: Buffer.from(samplePdf()).toString('base64') }),
      })
    );
    await page.goto(`http://localhost:${port}/`);
    expect(await page.evaluate(() => navigator.pdfViewerEnabled)).toBe(false);
    await page.locator('[data-menu="file"] > [role="menuitem"]').click();
    await page.locator('[data-slot="file.print"]').click();
    const failed = page.getByRole('alertdialog', { name: 'Print failed' });
    await expect(failed).toBeVisible({ timeout: 30_000 });
    await expect(failed.getByRole('alert')).toContainText('cannot print PDF files');
    await expect(failed.getByRole('link', { name: 'Open PDF' })).toHaveAttribute('href', /^blob:/);
    await expect(page.locator('[data-docx-print-frame]')).toHaveCount(0);
    expect(downloads).toEqual([]);
  });
}

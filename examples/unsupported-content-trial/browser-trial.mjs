import { chromium, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
const browser = await chromium.launch({
  headless: true,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
});
const results = [];
for (const framework of ['react', 'vue']) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  const errors = [],
    warnings = [],
    responses = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
    if (m.type() === 'warning') warnings.push(m.text().split('\n')[0]);
  });
  page.on('response', (r) => {
    if (r.status() >= 400) responses.push([r.status(), r.url()]);
  });
  try {
    await page.goto('http://127.0.0.1:5199/?framework=' + framework);
    const card = page.locator('.graphic-card');
    await expect(card).toHaveCount(1);
    const input = page.getByRole('textbox', { name: 'Annotation' });
    const details = page.getByRole('button', { name: 'Details', exact: true });
    await details.click();
    await expect(page.getByTestId('details')).toBeVisible();
    await input.fill('Review chart with client');
    await input.focus();
    await input.evaluate((el) => el.setSelectionRange(7, 12));
    await page
      .getByRole('button', { name: 'Change zoom', exact: true })
      .evaluate((el) => el.click());
    await page.waitForTimeout(500);
    const stateAfterZoom = await input.evaluate((el) => ({
      value: el.value,
      focused: document.activeElement === el,
      start: el.selectionStart,
      end: el.selectionEnd,
    }));
    await expect(input).toHaveValue('Review chart with client');
    await expect(details).toHaveAttribute('aria-expanded', 'true');
    expect(stateAfterZoom.focused).toBe(true);
    expect(stateAfterZoom.start).toBe(7);
    expect(stateAfterZoom.end).toBe(12);
    await input.press('ArrowLeft');
    await input.press('Meta+ArrowRight');
    await input.press('Backspace');
    await expect(input).toHaveValue('Review chart with clien');
    const docText = page.getByText('A simple DrawingML diagram:', { exact: true });
    await docText.click();
    await page.keyboard.press('Meta+ArrowLeft');
    await page.keyboard.type('Reviewed: ');
    await page.waitForTimeout(500);
    const edited = await page.locator('body').innerText();
    expect(edited).toContain('Reviewed: A simple DrawingML diagram:');
    await expect(input).toHaveValue('Review chart with clien');
    await expect(details).toHaveAttribute('aria-expanded', 'true');
    await page.getByRole('checkbox', { name: 'Custom placeholders' }).uncheck();
    await expect(card).toHaveCount(0);
    await expect(page.getByText('Unsupported graphic (graphic)', { exact: true })).toBeVisible();
    const fallback = await page
      .getByText('Unsupported graphic (graphic)', { exact: true })
      .evaluate((el) => ({
        role: el.getAttribute('role'),
        label: el.getAttribute('aria-label'),
        editable: el.getAttribute('contenteditable'),
      }));
    await page.getByRole('checkbox', { name: 'Custom placeholders' }).check();
    await expect(card).toHaveCount(1);
    await expect(input).toHaveValue('');
    await expect(details).toHaveAttribute('aria-expanded', 'false');
    await page.screenshot({
      path: '/tmp/unsupported-trial-interactive-' + framework + '.png',
      fullPage: true,
    });
    results.push({
      framework,
      passed: true,
      stateAfterZoom,
      editPreservedState: true,
      fallback,
      overrideRemovalResetsLocalState: true,
      errors,
      warnings: [...new Set(warnings)],
      responses,
    });
  } catch (error) {
    results.push({
      framework,
      passed: false,
      failure: String(error),
      errors,
      warnings: [...new Set(warnings)],
      responses,
    });
    await page.screenshot({
      path: '/tmp/unsupported-trial-failure-' + framework + '.png',
      fullPage: true,
    });
  }
  await page.close();
}
await browser.close();
await writeFile('/tmp/unsupported-trial-results.json', JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));

import { chromium, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import JSZip from 'jszip';
const browser = await chromium.launch({
  headless: true,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
});
const original = await JSZip.loadAsync(
  await readFile(new URL('./public/custom-source.docx', import.meta.url))
);
const originalXml = await original.file('word/document.xml').async('string');
const results = [];
function opaqueSource(xml) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('Invalid saved XML');
  function normalize(node) {
    if (node.nodeType === 3) return node.textContent;
    return {
      namespace: node.namespaceURI,
      name: node.localName,
      attrs: Array.from(node.attributes || [])
        .filter((a) => a.namespaceURI !== 'http://www.w3.org/2000/xmlns/')
        .map((a) => [a.namespaceURI, a.localName, a.value])
        .sort(),
      children: Array.from(node.childNodes).map(normalize),
    };
  }
  return ['approval', 'reference'].map((name) =>
    normalize(doc.getElementsByTagNameNS('urn:consumer-review', name)[0])
  );
}
for (const framework of ['react', 'vue']) {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1200 } });
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
  let stage = 'initial render';
  try {
    await page.goto('http://127.0.0.1:5199/?framework=' + framework);
    const card = page.locator('.graphic-card[data-local-name="approval"]');
    await expect(card).toHaveCount(1);
    await expect(page.locator('.reference-chip')).toHaveCount(1);
    await expect(page.locator('.graphic-card')).toHaveCount(2);
    const details = card.getByRole('button', { name: 'Details', exact: true });
    const input = card.getByRole('textbox', { name: 'Annotation' });
    await details.click();
    await expect(card.getByTestId('details')).toBeVisible();
    await input.fill('Review legal approval');
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
    expect(stateAfterZoom).toEqual({
      value: 'Review legal approval',
      focused: true,
      start: 7,
      end: 12,
    });
    await expect(details).toHaveAttribute('aria-expanded', 'true');
    await input.press('Meta+ArrowRight');
    await input.press('Backspace');
    await expect(input).toHaveValue('Review legal approva');
    await page.getByText('A simple DrawingML diagram:', { exact: true }).click();
    await page.keyboard.press('Meta+ArrowLeft');
    await page.keyboard.type('Reviewed: ');
    await expect(
      page.getByText('Reviewed: A simple DrawingML diagram:', { exact: true })
    ).toBeVisible();
    await expect(input).toHaveValue('Review legal approva');
    await expect(details).toHaveAttribute('aria-expanded', 'true');
    await page.getByRole('checkbox', { name: 'Custom components' }).uncheck();
    await expect(page.locator('.graphic-card')).toHaveCount(0);
    await expect(page.locator('.reference-chip')).toHaveCount(0);
    const fallbacks = await page.locator('[data-docx-unsupported]').evaluateAll((nodes) =>
      nodes.map((n) => ({
        name: n.getAttribute('data-docx-unsupported'),
        text: n.textContent,
        display: getComputedStyle(n).display,
        bounds: n.getBoundingClientRect().toJSON(),
      }))
    );
    expect(fallbacks.length).toBeGreaterThanOrEqual(3);
    await page.getByRole('checkbox', { name: 'Custom components' }).check();
    await expect(card).toHaveCount(1);
    await expect(input).toHaveValue('');
    await expect(details).toHaveAttribute('aria-expanded', 'false');
    stage = 'registration removal';
    await page.getByRole('checkbox', { name: 'Register custom XML' }).uncheck();
    await expect(card).toHaveCount(0);
    await expect(page.locator('.reference-chip')).toHaveCount(0);
    await expect(page.locator('.graphic-card')).toHaveCount(1);
    stage = 'registration restoration';
    await page.getByRole('checkbox', { name: 'Register custom XML' }).check();
    await expect(card).toHaveCount(1);
    await expect(page.locator('.reference-chip')).toHaveCount(1);
    stage = 'save and source comparison';
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Save DOCX', exact: true }).click();
    const download = await downloadPromise;
    const saved = await readFile(await download.path());
    const zip = await JSZip.loadAsync(saved);
    const savedXml = await zip.file('word/document.xml').async('string');
    const expectedSource = await page.evaluate(opaqueSource, originalXml);
    const actualSource = await page.evaluate(opaqueSource, savedXml);
    expect(actualSource).toEqual(expectedSource);
    expect(savedXml).toContain('Reviewed: ');
    expect(savedXml).not.toContain('Review legal approva');
    stage = 'reopen saved source';
    await page.route('**/custom-source.docx*', (route) =>
      route.request().resourceType() !== 'fetch'
        ? route.continue()
        : route.fulfill({
            body: saved,
            contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          })
    );
    await page.reload();
    await expect(card).toHaveCount(1);
    await expect(page.locator('.reference-chip')).toHaveCount(1);
    await expect(
      page.getByText('Reviewed: A simple DrawingML diagram:', { exact: true })
    ).toBeVisible();
    await page.screenshot({
      path: '/tmp/unsupported-trial-interactive-' + framework + '.png',
      fullPage: true,
    });
    results.push({
      framework,
      passed: true,
      stateAfterZoom,
      editPreservedState: true,
      fallbacks,
      registrationRemoval: true,
      sourceRoundtrip: true,
      reopenSavedDocument: true,
      errors,
      warnings: [...new Set(warnings)],
      responses,
    });
  } catch (error) {
    results.push({
      framework,
      passed: false,
      stage,
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
if (results.some((r) => !r.passed)) process.exitCode = 1;

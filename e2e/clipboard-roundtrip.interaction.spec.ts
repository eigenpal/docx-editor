// The rich-clipboard north star, on the real keyboard path (rich-clipboard-fidelity 4.6).
//
// Select-all on the demo's default sample document, copy, New (blank document), paste —
// through the browser's own clipboard, not a synthesized DataTransfer. The VERBATIM
// comparison is the store-level oracle in
// `packages/core/src/store/__tests__/clipboard-fragment.test.ts`; this spec proves the
// wiring around it: the flavours land on the real clipboard, the fragment lane wins on
// paste, structure and media survive into the saved bytes, and Ctrl+Shift+V still forces
// the plain lane.

import { expect, test, type Page } from '@playwright/test';
import { unzipSync, strFromU8 } from 'fflate';

const DEMO_URL = 'http://localhost:5273/?e2e=1';
const PAGE = '.docx-page';

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

async function hookReady(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__DOCX_EDITOR_E2E__?.ready() === true, undefined, {
    timeout: 30_000,
  });
}

async function focusPages(page: Page): Promise<void> {
  await page.locator(PAGE).first().click({ position: { x: 200, y: 120 } });
}

async function savedEntries(page: Page): Promise<Record<string, Uint8Array>> {
  const bytes = await page.evaluate(async () => {
    const saved = await window.__DOCX_EDITOR_E2E__!.saveBytes();
    return saved ? Array.from(saved) : null;
  });
  expect(bytes).not.toBeNull();
  return unzipSync(new Uint8Array(bytes!));
}

async function newBlankDocument(page: Page): Promise<void> {
  // The e2e harness mounts no demo chrome; `'blank'` is the engine's own constant for the
  // demo's New action (`editor.load('blank')`).
  await page.evaluate(async () => {
    await window.__DOCX_EDITOR_E2E__!.getEditor()!.load('blank');
  });
  await page.waitForSelector(PAGE, { timeout: 30_000 });
  await hookReady(page);
}

test.beforeEach(async ({ page }) => {
  await page.goto(DEMO_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(PAGE, { timeout: 30_000 });
  await hookReady(page);
});

test('a select-all copy of the whole sample stays inside its latency budget', async ({
  page,
}) => {
  // The copy-side sibling of the `huge-paste-50k` gate: flavour assembly (fragment zip,
  // interop HTML, base64) runs synchronously in the copy handler, so a whole-document
  // copy is the worst case. Generous ceiling — this is a regression tripwire, not a tuned
  // benchmark.
  await focusPages(page);
  await page.keyboard.press('ControlOrMeta+a');
  const elapsed = await page.evaluate(() => {
    const start = performance.now();
    document.execCommand('copy');
    return performance.now() - start;
  });
  expect(elapsed).toBeLessThan(3000);
});

test('select-all copy pastes the sample into a blank document with its structure', async ({
  page,
}) => {
  await focusPages(page);
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('ControlOrMeta+c');

  await newBlankDocument(page);
  const blankPages = await page.locator(PAGE).count();

  await focusPages(page);
  await page.keyboard.press('ControlOrMeta+v');

  // The sample is ~25 pages of content; a plain-text degrade would still add pages, so
  // the structural assertions below are the ones that tell the lanes apart.
  await expect
    .poll(async () => page.locator(PAGE).count(), { timeout: 30_000 })
    .toBeGreaterThan(blankPages + 3);

  const entries = await savedEntries(page);
  const names = Object.keys(entries);

  // Media traveled by bytes, notes as parts, numbering as definitions.
  expect(names.some((name) => name.startsWith('word/media/'))).toBe(true);
  expect(names).toContain('word/footnotes.xml');
  expect(names).toContain('word/endnotes.xml');
  expect(names).toContain('word/numbering.xml');

  const documentXml = strFromU8(entries['word/document.xml']!);
  expect(documentXml).toContain('<w:tbl>');
  expect(documentXml).toContain('w:numPr');
  expect(documentXml).toContain('<w:hyperlink');
  expect(documentXml).toContain('<w:drawing>');
  expect(documentXml).toContain('footnoteReference');
  // Coverage judged against the layout's paragraph universe: the TOC travels as an SDT
  // and vertically merged tables keep their structure instead of flattening.
  expect(documentXml).toContain('<w:sdt>');
  expect(documentXml).toContain('vMerge');
  expect(documentXml).toContain('gridSpan');

  const stylesXml = strFromU8(entries['word/styles.xml']!);
  expect(stylesXml).toContain('Heading1');
});

test('paste without formatting forces the plain lane on the same payload', async ({ page }) => {
  await focusPages(page);
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('ControlOrMeta+c');

  await newBlankDocument(page);
  await focusPages(page);
  // Headless Chromium does not deliver a native paste event for the Cmd+Shift+V chord,
  // so this drives the same lane through the command it arms; the chord-to-flag wiring
  // is pinned in `clipboard-rich-surface.test.ts`.
  await page.evaluate(async () => {
    const text = await navigator.clipboard.readText();
    window.__DOCX_EDITOR_E2E__!.getEditor()!.exec({ type: 'pasteWithoutFormatting', text });
  });

  await expect
    .poll(async () => page.locator(PAGE).count(), { timeout: 30_000 })
    .toBeGreaterThan(1);

  const entries = await savedEntries(page);
  const documentXml = strFromU8(entries['word/document.xml']!);
  // Text landed; structure did not — the two lanes are distinguishable in the bytes.
  expect(documentXml.includes('<w:tbl>')).toBe(false);
  expect(documentXml.includes('<w:drawing>')).toBe(false);
  expect(Object.keys(entries).some((name) => name.startsWith('word/media/'))).toBe(false);
});

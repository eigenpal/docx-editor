import { expect, forEachAdapter, openEditor } from '../parity-fixture';

forEachAdapter('smoke: editor mounts', async (adapter, { page }) => {
  await openEditor(page, adapter);
  const pageCount = await page.evaluate(() => window.__DOCX_EDITOR_E2E__?.getTotalPages() ?? 0);
  expect(pageCount).toBeGreaterThan(0);
});

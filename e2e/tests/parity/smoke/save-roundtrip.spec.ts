import { expect, forEachAdapter, openEditor } from '../parity-fixture';

forEachAdapter('smoke: save returns docx bytes', async (adapter, { page }) => {
  await openEditor(page, adapter);
  const byteLength = await page.evaluate(
    () => window.__DOCX_EDITOR_E2E__?.saveByteLength() ?? null
  );
  expect(byteLength).toBeGreaterThan(1000);
});

import { expect, forEachAdapter, openEditor } from '../parity-fixture';

forEachAdapter('smoke: inserts text through bridge', async (adapter, { page }) => {
  await openEditor(page, adapter);
  const inserted = await page.evaluate(() => {
    const hook = window.__DOCX_EDITOR_E2E__;
    const paraId =
      hook?.getFirstTextblockParaId() ??
      hook?.agentGetPageContent(1)?.paragraphs.find((paragraph) => paragraph.text.trim().length > 0)
        ?.paraId;
    if (!hook || !paraId) return false;
    return hook.agentProposeChange({
      paraId,
      search: '',
      replaceWith: ' smoke',
      author: 'Parity Smoke',
    });
  });
  expect(inserted).toBe(true);
  await expect
    .poll(() => page.evaluate(() => window.__DOCX_EDITOR_E2E__?.agentGetDocumentText() ?? ''))
    .toContain('smoke');
});

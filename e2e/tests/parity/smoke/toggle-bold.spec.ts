import { expect, forEachAdapter, openEditor } from '../parity-fixture';

forEachAdapter('smoke: applies bold through bridge', async (adapter, { page }) => {
  await openEditor(page, adapter);
  const applied = await page.evaluate(() => {
    const hook = window.__DOCX_EDITOR_E2E__;
    const firstPage = hook?.agentGetPageContent(1);
    const paragraph = firstPage?.paragraphs.find((item) => item.text.trim().length > 0);
    const word = paragraph?.text.trim().split(/\s+/)[0];
    if (!hook || !paragraph || !word) return false;
    return hook.agentApplyFormatting({
      paraId: paragraph.paraId,
      search: word,
      marks: { bold: true },
    });
  });
  expect(applied).toBe(true);
});

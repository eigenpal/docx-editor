import { expect, forEachAdapter, openEditor } from '../parity-fixture';

forEachAdapter('smoke: agent comment tool updates editor', async (adapter, { page }) => {
  await openEditor(page, adapter);
  const commentId = await page.evaluate(() => {
    const hook = window.__DOCX_EDITOR_E2E__;
    const paraId =
      hook?.getFirstTextblockParaId() ??
      hook?.agentGetPageContent(1)?.paragraphs.find((paragraph) => paragraph.text.trim().length > 0)
        ?.paraId;
    if (!hook || !paraId) return null;
    return hook.agentAddComment({
      paraId,
      text: 'Parity smoke comment',
      author: 'Parity Smoke',
    });
  });
  expect(commentId).toBeGreaterThan(0);
  await expect
    .poll(() => page.evaluate(() => window.__DOCX_EDITOR_E2E__?.agentGetCommentCount() ?? 0))
    .toBeGreaterThan(0);
});

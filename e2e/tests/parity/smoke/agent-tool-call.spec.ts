import { expect, forEachAdapter, openEditor } from '../parity-fixture';

forEachAdapter('smoke: agent comment tool updates editor', async (adapter, { page }) => {
  await openEditor(page, adapter);
  const commentId = await page.evaluate(() => {
    const hook = window.__DOCX_EDITOR_E2E__;
    // Comment ranges must be non-empty, so target a paragraph that actually has
    // text. `getFirstTextblockParaId` can resolve to an empty paragraph (e.g. a
    // trailing empty block), which the core correctly refuses to comment on.
    const paraId =
      hook?.agentGetPageContent(1)?.paragraphs.find((paragraph) => paragraph.text.trim().length > 0)
        ?.paraId ?? hook?.getFirstTextblockParaId();
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

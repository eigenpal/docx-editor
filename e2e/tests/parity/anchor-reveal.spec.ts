/**
 * Parity spec: the location-reveal ref methods (highlightRange /
 * scrollToCommentId / scrollToChangeId) behave identically on the React (5173)
 * and Vue (5174) adapters. Both route through the same core resolvers
 * (findCommentRange / findChangeRange / clampRangeToDoc).
 *
 * Regression guard: highlightRange takes raw caller positions, so an
 * out-of-range `to` must clamp (not throw a RangeError in doc.resolve()), and
 * a `from` past the document end must no-op.
 */

import { forEachAdapter, openEditor, expect } from './parity-fixture';

forEachAdapter('highlightRange selects a valid range and reveals it', async (adapter, { page }) => {
  await openEditor(page, adapter);

  const anchor = await page.evaluate(() => {
    const hook = window.__DOCX_EDITOR_E2E__;
    // Resolve a real paragraph paraId the same way the fixture's openEditor
    // does (some demo docs leave the first textblock without a paraId attr).
    const firstId =
      hook?.getFirstTextblockParaId() ??
      hook?.agentGetPageContent(1)?.paragraphs.find((p) => p.text.trim().length > 0)?.paraId ??
      null;
    if (!firstId) return null;
    const end = hook?.getTextblockEndForParaId(firstId);
    if (end == null) return null;
    // A 1-char in-bounds range ending at the paragraph's end.
    hook?.highlightRange(end - 1, end);
    return { expected: end - 1, actual: hook?.getSelectionAnchor() ?? null };
  });

  expect(anchor).not.toBeNull();
  expect(anchor!.actual).toBe(anchor!.expected);
});

forEachAdapter(
  'highlightRange clamps an out-of-range `to` instead of crashing',
  async (adapter, { page }) => {
    await openEditor(page, adapter);

    const result = await page.evaluate(() => {
      const hook = window.__DOCX_EDITOR_E2E__;
      const docSize = hook?.getDocSize() ?? null;
      if (docSize == null) return null;
      // `to` well past the end — previously threw a RangeError in doc.resolve().
      hook?.highlightRange(1, docSize + 1000);
      return { docSize, anchor: hook?.getSelectionAnchor() ?? null };
    });

    expect(result).not.toBeNull();
    // No throw (evaluate resolved) and the selection stayed within the doc.
    expect(result!.anchor).not.toBeNull();
    expect(result!.anchor as number).toBeGreaterThanOrEqual(0);
    expect(result!.anchor as number).toBeLessThanOrEqual(result!.docSize);
  }
);

forEachAdapter('highlightRange no-ops for a `from` past the end', async (adapter, { page }) => {
  await openEditor(page, adapter);

  const result = await page.evaluate(() => {
    const hook = window.__DOCX_EDITOR_E2E__;
    const docSize = hook?.getDocSize() ?? null;
    if (docSize == null) return null;
    const before = hook?.getSelectionAnchor() ?? null;
    hook?.highlightRange(docSize + 50, docSize + 100);
    return { before, after: hook?.getSelectionAnchor() ?? null };
  });

  expect(result).not.toBeNull();
  expect(result!.before).not.toBeNull();
  expect(result!.after).toBe(result!.before);
});

forEachAdapter('scrollToCommentId resolves a planted comment', async (adapter, { page }) => {
  await openEditor(page, adapter);

  const result = await page.evaluate(() => {
    const hook = window.__DOCX_EDITOR_E2E__;
    const firstId = hook?.getFirstTextblockParaId();
    if (!firstId) return null;
    const commentId = hook?.agentAddComment({ paraId: firstId, text: 'reveal me' }) ?? null;
    if (commentId == null) return null;
    const ok = hook?.scrollToCommentId(commentId) ?? false;
    const missing = hook?.scrollToCommentId(999999) ?? true;
    return { ok, missing, anchor: hook?.getSelectionAnchor() ?? null };
  });

  expect(result).not.toBeNull();
  expect(result!.ok).toBe(true);
  // Selection moved to the comment's anchored range.
  expect(result!.anchor).not.toBeNull();
  // An id that no longer resolves returns false (not a throw, not a no-op).
  expect(result!.missing).toBe(false);
});

forEachAdapter('scrollToChangeId returns false for an unknown id', async (adapter, { page }) => {
  await openEditor(page, adapter);

  const missing = await page.evaluate(
    () => window.__DOCX_EDITOR_E2E__?.scrollToChangeId(999999) ?? true
  );

  expect(missing).toBe(false);
});

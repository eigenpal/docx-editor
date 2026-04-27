/**
 * E2E for the live agent bridge: addComment / proposeChange / scrollToParaId etc.
 *
 * Drives the same DocxEditorRef methods the agent's tools call, asserts the
 * marks land in the document, the sidebar shows the agent's comment, and the
 * change survives undo.
 *
 * Uses the Vite demo's `window.__DOCX_EDITOR_E2E__` opt-in hook (?e2e=1).
 */

import { test, expect } from '@playwright/test';
import { EditorPage } from '../helpers/editor-page';

/** Locate any paragraph that has a uniquely-findable 5-char substring. */
async function pickUniqueMatch(
  page: import('@playwright/test').Page
): Promise<{ paraId: string; match: string; before: string; after: string } | null> {
  return await page.evaluate(() => {
    const paras = Array.from(
      document.querySelectorAll('.paged-editor__pages [data-doc-from]')
    ) as HTMLElement[];
    for (const p of paras) {
      const text = (p.textContent ?? '').trim();
      if (text.length < 6) continue;
      for (let start = 0; start + 5 <= text.length; start++) {
        const cand = text.substring(start, start + 5);
        if (text.indexOf(cand) !== text.lastIndexOf(cand)) continue;
        const matches = window.__DOCX_EDITOR_E2E__?.agentFind(cand) ?? [];
        if (matches.length === 1) return matches[0];
      }
    }
    return null;
  });
}

async function getFirstParaId(page: import('@playwright/test').Page): Promise<string | null> {
  // Wait for the bridge hook itself, then for the doc to have a paraId.
  await page.waitForFunction(() => Boolean(window.__DOCX_EDITOR_E2E__), undefined, {
    timeout: 15000,
  });
  await page
    .waitForFunction(
      () => Boolean(window.__DOCX_EDITOR_E2E__?.getFirstTextblockParaId()),
      undefined,
      { timeout: 15000 }
    )
    .catch(() => undefined);
  return await page.evaluate(() => window.__DOCX_EDITOR_E2E__?.getFirstTextblockParaId() ?? null);
}

test.describe('Agent bridge — paraId-anchored mutations', () => {
  test.beforeEach(async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.goto();
    await editor.waitForReady();
    // Default demo doc lacks paraIds. Load a fixture that has them so the
    // bridge has stable anchors to operate on.
    await editor.loadDocxFile('fixtures/example-with-image.docx');
  });

  test('addComment via agent bridge anchors a comment on the right paraId', async ({ page }) => {
    const paraId = await getFirstParaId(page);
    test.skip(!paraId, 'Demo doc has no paraIds yet');

    const commentId = await page.evaluate(
      ([id]) =>
        window.__DOCX_EDITOR_E2E__?.agentAddComment({
          paraId: id,
          text: 'Agent says: review this paragraph.',
        }) ?? null,
      [paraId]
    );

    expect(commentId).not.toBeNull();
    expect(typeof commentId).toBe('number');

    // Sidebar shows the agent's comment text.
    await expect(page.getByText('Agent says: review this paragraph.')).toBeVisible({
      timeout: 5000,
    });

    // The comment mark exists in the live PM doc on the requested paraId.
    const hasMark = await page.evaluate((cid) => {
      const pages = document.querySelector('.paged-editor__pages');
      if (!pages) return false;
      return Boolean(pages.querySelector(`[data-comment-id="${cid}"]`));
    }, commentId as number);
    expect(hasMark).toBe(true);
  });

  test('proposeChange creates a tracked change visible in the editor', async ({ page }) => {
    await getFirstParaId(page);

    const target = await pickUniqueMatch(page);
    test.skip(!target, 'No paragraph with a uniquely-findable phrase');
    const paraId = target!.paraId;
    const match = target!.match;

    const ok = await page.evaluate(
      ([id, search]) =>
        window.__DOCX_EDITOR_E2E__?.agentProposeChange({
          paraId: id,
          search,
          replaceWith: 'AGENT-INSERTED',
        }) ?? false,
      [paraId, match]
    );
    expect(ok).toBe(true);

    // Insertion mark renders the green-underline class on the new text.
    // (Hidden ProseMirror + visible pages may both render the same node.)
    await expect(
      page.locator('.docx-insertion').filter({ hasText: 'AGENT-INSERTED' }).first()
    ).toBeVisible({ timeout: 5000 });
    // Deletion mark renders red-strikethrough on the original text.
    await expect(page.locator('.docx-deletion').filter({ hasText: match }).first()).toBeVisible({
      timeout: 5000,
    });
  });

  test('addComment + undo cleans the comment from the sidebar', async ({ page }) => {
    const paraId = await getFirstParaId(page);
    test.skip(!paraId, 'Demo doc has no paraIds yet');

    const commentId = await page.evaluate(
      ([id]) =>
        window.__DOCX_EDITOR_E2E__?.agentAddComment({
          paraId: id,
          text: 'temp-agent-comment',
        }) ?? null,
      [paraId]
    );
    expect(commentId).not.toBeNull();

    await expect(page.getByText('temp-agent-comment')).toBeVisible({ timeout: 5000 });

    // Focus the editor before issuing the keyboard shortcut.
    await page.locator('.paged-editor__hidden-pm').focus();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');

    // cleanOrphanedComments is debounced 300ms; wait a beat then assert removal.
    await expect(page.getByText('temp-agent-comment')).toHaveCount(0, { timeout: 5000 });
  });

  test('proposeChange refuses to layer onto existing tracked change', async ({ page }) => {
    await getFirstParaId(page);

    const target = await pickUniqueMatch(page);
    test.skip(!target, 'No paragraph with a uniquely-findable phrase');
    const paraId = target!.paraId;
    const match = target!.match;

    const first = await page.evaluate(
      ([id, search]) =>
        window.__DOCX_EDITOR_E2E__?.agentProposeChange({
          paraId: id,
          search,
          replaceWith: 'X',
        }) ?? false,
      [paraId, match]
    );
    expect(first).toBe(true);

    // Attempting to replace the same text again should fail (it's now in a
    // tracked-change run, and `match` no longer appears as raw text).
    const second = await page.evaluate(
      ([id, search]) =>
        window.__DOCX_EDITOR_E2E__?.agentProposeChange({
          paraId: id,
          search,
          replaceWith: 'Y',
        }) ?? true,
      [paraId, match]
    );
    expect(second).toBe(false);
  });

  test('onContentChange listener fires when agent adds a comment', async ({ page }) => {
    const paraId = await getFirstParaId(page);
    test.skip(!paraId, 'Demo doc has no paraIds yet');

    // Subscribe before the mutation. Reset the counter so we measure deltas.
    await page.evaluate(() => {
      const hook = window.__DOCX_EDITOR_E2E__!;
      hook.agentOnContentChangeCount = 0;
      hook.agentSubscribeContentChange();
    });

    await page.evaluate(
      ([id]) =>
        window.__DOCX_EDITOR_E2E__?.agentAddComment({
          paraId: id,
          text: 'observed-by-listener',
        }) ?? null,
      [paraId]
    );

    // The listener fires asynchronously via the editor's onChange path.
    await page.waitForFunction(
      () => (window.__DOCX_EDITOR_E2E__?.agentOnContentChangeCount ?? 0) > 0,
      undefined,
      { timeout: 5000 }
    );
    const count = await page.evaluate(
      () => window.__DOCX_EDITOR_E2E__?.agentOnContentChangeCount ?? 0
    );
    expect(count).toBeGreaterThan(0);
  });

  test('scrollToParaId returns false for unknown paraId', async ({ page }) => {
    const ok = await page.evaluate(
      () => window.__DOCX_EDITOR_E2E__?.scrollToParaId('NOT_A_PARA_ID') ?? null
    );
    expect(ok).toBe(false);
  });
});

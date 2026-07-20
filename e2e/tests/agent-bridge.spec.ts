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

  test('rapid sequential addComment calls all persist (regression: stale ref)', async ({
    page,
  }) => {
    // Regression for the agent panel's roast-my-doc flow: when the model
    // emits 5+ `add_comment` tool calls in a single turn, every call hits
    // the bridge synchronously in the same React tick. The unified
    // setComments setter previously read a stale `commentsRef.current` for
    // every call, so only the last comment survived. Verify all stick.
    const paraId = await getFirstParaId(page);
    test.skip(!paraId, 'Fixture has no paraIds');

    const beforeCount = await page.evaluate(
      () => window.__DOCX_EDITOR_E2E__?.agentGetCommentCount() ?? 0
    );

    // Fire 5 addComment calls back-to-back inside a single page.evaluate so
    // they execute synchronously in the same React tick.
    const ids = await page.evaluate(
      ([id]) => {
        const hook = window.__DOCX_EDITOR_E2E__;
        if (!hook) return [];
        return Array.from({ length: 5 }, (_, i) =>
          hook.agentAddComment({ paraId: id!, text: `Burst comment ${i + 1}` })
        );
      },
      [paraId]
    );

    expect(ids.filter((x) => typeof x === 'number')).toHaveLength(5);

    // After React commits, the comment count grew by 5 — not 1.
    const afterCount = await page.evaluate(
      () => window.__DOCX_EDITOR_E2E__?.agentGetCommentCount() ?? 0
    );
    expect(afterCount - beforeCount).toBe(5);
  });

  test('programmatic addComment lays out sidebar cards without overlap (no click required)', async ({
    page,
  }) => {
    // Regression: adding comments via the agent ref previously did not trigger
    // the sidebar to re-measure card heights, so multiple cards anchored to
    // nearby paragraphs would overlap until the user clicked one — which fired
    // the [expandedItem] re-measure effect and snapped the layout into place.

    await page.waitForFunction(() => Boolean(window.__DOCX_EDITOR_E2E__), undefined, {
      timeout: 15000,
    });

    // Pull paraIds from page 1 via the bridge. Need at least 3 distinct
    // paragraphs so we can anchor each comment to its own paragraph.
    const paraIds: string[] = await page.evaluate(() => {
      const page = window.__DOCX_EDITOR_E2E__?.agentGetPageContent(1);
      const ids = new Set<string>();
      for (const p of page?.paragraphs ?? []) {
        if (p.paraId) ids.add(p.paraId);
        if (ids.size >= 3) break;
      }
      return Array.from(ids);
    });
    test.skip(paraIds.length < 3, 'Fixture lacks 3 paragraphs with paraIds');

    // Long body text that wraps across multiple lines so the rendered card is
    // taller than the 80px height estimate. Without a re-measure on add,
    // collision avoidance under-estimates and stacked cards overlap the
    // taller real cards above them.
    const longText =
      'This is a deliberately long comment body that wraps across several ' +
      'lines so the rendered card is taller than the 80 pixel height ' +
      'estimate used by collision avoidance before cards are measured.';

    // Baseline: one comment fully rendered before streaming the rest.
    const firstId = await page.evaluate(
      ([id, body]) =>
        window.__DOCX_EDITOR_E2E__?.agentAddComment({ paraId: id!, text: body! }) ?? null,
      [paraIds[0], longText]
    );
    expect(typeof firstId).toBe('number');
    await expect(page.locator('.docx-comment-card')).toHaveCount(1, { timeout: 5000 });
    await page.waitForTimeout(500);

    await page.evaluate(
      ([ids, body]) => {
        const hook = window.__DOCX_EDITOR_E2E__;
        if (!hook) return;
        for (let i = 1; i < ids.length; i++) {
          hook.agentAddComment({ paraId: ids[i]!, text: `${body} (#${i + 1})` });
        }
      },
      [paraIds, longText]
    );

    await expect(page.locator('.docx-comment-card')).toHaveCount(paraIds.length, {
      timeout: 5000,
    });
    // Do NOT click any card — clicking triggers the [expandedItem] re-measure
    // and would mask the bug. Wait for the [items.length] effect to settle.
    await page.waitForTimeout(600);

    const overlaps = await page.evaluate(() => {
      const cards = Array.from(
        document.querySelectorAll('.docx-unified-sidebar .docx-comment-card')
      ) as HTMLElement[];
      const rects = cards
        .map((el) => el.getBoundingClientRect())
        .filter((r) => r.height > 0 && r.width > 0)
        .sort((a, b) => a.top - b.top);
      const collisions: Array<{ a: number; b: number; gap: number }> = [];
      for (let i = 1; i < rects.length; i++) {
        const gap = rects[i].top - rects[i - 1].bottom;
        if (gap < -0.5) collisions.push({ a: i - 1, b: i, gap });
      }
      return { count: rects.length, collisions };
    });
    expect(overlaps.count).toBe(paraIds.length);
    expect(overlaps.collisions).toEqual([]);
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

  // Vanilla view: the agent only sees the document as it exists right now,
  // before any tracked-change suggestions are accepted. Deletion text is
  // still in the doc → searchable. Insertion text isn't in the doc yet →
  // not searchable. This test creates a redline via proposeChange, then
  // verifies addComment's anchor search treats the two halves accordingly.
  test('addComment search respects the vanilla view (deletion findable, insertion not)', async ({
    page,
  }) => {
    await getFirstParaId(page);

    const target = await pickUniqueMatch(page);
    test.skip(!target, 'No paragraph with a uniquely-findable phrase');
    const paraId = target!.paraId;
    const match = target!.match;

    // Stage a redline: replace `match` with `AGENT-INSERTED`. Now the
    // paragraph contains <w:del>match</w:del><w:ins>AGENT-INSERTED</w:ins>.
    const proposed = await page.evaluate(
      ([id, search]) =>
        window.__DOCX_EDITOR_E2E__?.agentProposeChange({
          paraId: id,
          search,
          replaceWith: 'AGENT-INSERTED',
        }) ?? false,
      [paraId, match]
    );
    expect(proposed).toBe(true);

    // The deletion text is still in the vanilla doc — addComment finds it.
    const onDeletion = await page.evaluate(
      ([id, search]) =>
        window.__DOCX_EDITOR_E2E__?.agentAddComment({
          paraId: id,
          text: 'comment-on-deleted-text',
          search,
        }) ?? null,
      [paraId, match]
    );
    expect(typeof onDeletion).toBe('number');

    // The insertion text isn't in the vanilla doc — addComment can't find it.
    const onInsertion = await page.evaluate(
      ([id]) =>
        window.__DOCX_EDITOR_E2E__?.agentAddComment({
          paraId: id,
          text: 'comment-on-inserted-text',
          search: 'AGENT-INSERTED',
        }) ?? null,
      [paraId]
    );
    expect(onInsertion).toBeNull();
  });

  // After a redline, the agent's read_document → find_text → add_comment chain
  // should still work end-to-end on the deletion text. This pins the alignment
  // between findInDocument (live editor's find_text source) and addComment.
  test('findInDocument still returns the deletion text after a redline', async ({ page }) => {
    await getFirstParaId(page);

    const target = await pickUniqueMatch(page);
    test.skip(!target, 'No paragraph with a uniquely-findable phrase');
    const paraId = target!.paraId;
    const match = target!.match;

    const proposed = await page.evaluate(
      ([id, search]) =>
        window.__DOCX_EDITOR_E2E__?.agentProposeChange({
          paraId: id,
          search,
          replaceWith: 'AGENT-INSERTED-2',
        }) ?? false,
      [paraId, match]
    );
    expect(proposed).toBe(true);

    // The deletion text is still in the vanilla doc — find_text returns it.
    const found = await page.evaluate(
      ([search]) => window.__DOCX_EDITOR_E2E__?.agentFind(search) ?? [],
      [match]
    );
    expect(Array.isArray(found)).toBe(true);
    expect(found.length).toBeGreaterThan(0);
    expect(found[0].paraId).toBe(paraId);

    // ...and the same handle anchors a comment.
    const cid = await page.evaluate(
      ([id, search]) =>
        window.__DOCX_EDITOR_E2E__?.agentAddComment({
          paraId: id,
          text: 'find-then-anchor',
          search,
        }) ?? null,
      [paraId, match]
    );
    expect(typeof cid).toBe('number');
  });

  // After staging an insertion, the inserted text must not appear in
  // findInDocument (the source of `find_text`). Otherwise the agent could
  // surface a phrase via find_text that it cannot anchor via add_comment.
  test('findInDocument does not return inserted text after a redline', async ({ page }) => {
    await getFirstParaId(page);

    const target = await pickUniqueMatch(page);
    test.skip(!target, 'No paragraph with a uniquely-findable phrase');
    const paraId = target!.paraId;
    const match = target!.match;

    const proposed = await page.evaluate(
      ([id, search]) =>
        window.__DOCX_EDITOR_E2E__?.agentProposeChange({
          paraId: id,
          search,
          replaceWith: 'AGENT-INSERTED-3',
        }) ?? false,
      [paraId, match]
    );
    expect(proposed).toBe(true);

    const found = await page.evaluate(
      () => window.__DOCX_EDITOR_E2E__?.agentFind('AGENT-INSERTED-3') ?? []
    );
    expect(found).toEqual([]);
  });

  // Phrase that exists in plain text AND inside an insertion. Pre-fix, the
  // search would treat both as candidates and refuse for ambiguity. Post-fix,
  // the insertion text is invisible so the anchor lands on the plain occurrence.
  test('addComment resolves on the plain occurrence when the same phrase is also inside an insertion', async ({
    page,
  }) => {
    await getFirstParaId(page);

    const target = await pickUniqueMatch(page);
    test.skip(!target, 'No paragraph with a uniquely-findable phrase');
    const paraId = target!.paraId;
    const match = target!.match;

    // Insert (as a tracked change) text that happens to repeat `match`. The
    // staged insertion now contains `match` once; the original paragraph
    // still contains `match` once. Two candidates total — but only one is
    // visible in the vanilla view.
    const proposed = await page.evaluate(
      ([id, replaceWith]) =>
        window.__DOCX_EDITOR_E2E__?.agentProposeChange({
          paraId: id,
          search: '',
          replaceWith,
        }) ?? false,
      [paraId, ` extra ${match} extra`]
    );
    expect(proposed).toBe(true);

    const cid = await page.evaluate(
      ([id, search]) =>
        window.__DOCX_EDITOR_E2E__?.agentAddComment({
          paraId: id,
          text: 'plain-occurrence-anchor',
          search,
        }) ?? null,
      [paraId, match]
    );
    expect(typeof cid).toBe('number');
  });
});

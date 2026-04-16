/**
 * Comments Sidebar — cursor-based expansion, resolve, reopen
 *
 * Covers the cursor-driven sidebar expansion refactor (#244) and the
 * state-identity dedup in PagedEditor.updateSelectionOverlay that fixes #268
 * (resolved comment checkmark didn't reopen because ResizeObserver re-fired
 * onSelectionChange with the unchanged cursor, clearing the just-set expansion).
 *
 * Run when touching:
 *   - packages/react/src/paged-editor/PagedEditor.tsx (updateSelectionOverlay)
 *   - packages/react/src/components/UnifiedSidebar.tsx
 *   - packages/react/src/components/sidebar/**
 *   - packages/react/src/hooks/useCommentSidebarItems.tsx
 *   - DocxEditor.tsx onSelectionChange / expandedSidebarItem logic
 */

import { test, expect, Page } from '@playwright/test';
import { EditorPage } from '../helpers/editor-page';

// ---------------------------------------------------------------------------
// Selectors & helpers
// ---------------------------------------------------------------------------

const SIDEBAR = '.docx-unified-sidebar';
const COMMENT_CARD = '.docx-comment-card';
// Sentinel word appended to every test's body to give moveCursorTo a
// known location that is definitely outside every comment mark.
const CLEAN = 'ZZEND';

async function openSidebar(page: Page) {
  const toggle = page.locator('[aria-label="Toggle comments sidebar"]');
  const pressed = await toggle.getAttribute('aria-pressed');
  if (pressed !== 'true') {
    await toggle.click();
    await page.waitForTimeout(100);
  }
}

async function startAddComment(editor: EditorPage, searchText: string) {
  const { page } = editor;
  const found = await editor.selectText(searchText);
  expect(found, `selectText should find "${searchText}"`).toBe(true);
  await page.waitForTimeout(200);

  await page.waitForFunction(
    () => {
      const buttons = document.querySelectorAll('[data-testid="docx-editor"] button');
      for (const b of buttons) {
        const s = getComputedStyle(b);
        if (s.position === 'absolute' && s.zIndex === '50') return true;
      }
      return false;
    },
    null,
    { timeout: 3000 }
  );

  const floating = await page.evaluateHandle(() => {
    const buttons = document.querySelectorAll('[data-testid="docx-editor"] button');
    for (const b of buttons) {
      const s = getComputedStyle(b);
      if (s.position === 'absolute' && s.zIndex === '50') return b;
    }
    return null;
  });
  const floatingEl = floating.asElement();
  expect(floatingEl, 'floating add-comment button should mount').not.toBeNull();
  await floatingEl!.click();
  await page.waitForSelector(`${SIDEBAR} textarea`, { state: 'visible', timeout: 3000 });
}

async function submitComment(page: Page, text: string) {
  const textarea = page.locator(`${SIDEBAR} textarea`).last();
  await textarea.fill(text);
  await textarea.press('Enter');
  await page.waitForTimeout(300);
}

async function addCommentOn(editor: EditorPage, searchText: string, body: string) {
  await startAddComment(editor, searchText);
  await submitComment(editor.page, body);
}

function commentCard(page: Page, commentId: number) {
  return page.locator(`${SIDEBAR} ${COMMENT_CARD}[data-comment-id="${commentId}"]`);
}

function resolvedMarker(page: Page, commentId: number) {
  return page.locator(`${SIDEBAR} [data-comment-id="${commentId}"][data-comment-resolved="true"]`);
}

/**
 * Return the computed background-color of the first doc-body span that
 * carries the given commentId, or '' if no such span / no inline style.
 * Active comments paint a yellow background; hidden resolved ones fall back
 * to transparent / the paragraph default.
 */
async function getCommentHighlight(page: Page, commentId: number): Promise<string> {
  return page.evaluate((id) => {
    const span = document.querySelector(
      `.paged-editor__pages [data-comment-id="${id}"]`
    ) as HTMLElement | null;
    if (!span) return '';
    return getComputedStyle(span).backgroundColor || '';
  }, commentId);
}

function isYellowish(rgb: string): boolean {
  // 'rgba(255, 212, 0, 0.15)' → keep as-is; covers both the 0.15 default and
  // the 0.35 expanded override. Anything with rgb starting high-red, high-green,
  // low-blue counts.
  const m = rgb.match(/rgba?\(([^)]+)\)/);
  if (!m) return false;
  const [r, g, b] = m[1].split(',').map((s) => Number(s.trim()));
  return r >= 200 && g >= 150 && b < 80;
}

async function getSidebarCommentIds(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    const els = document.querySelectorAll('.docx-unified-sidebar [data-comment-id]');
    const ids = new Set<number>();
    for (const el of els) {
      const raw = (el as HTMLElement).dataset.commentId;
      if (raw) {
        const n = Number(raw);
        if (!Number.isNaN(n)) ids.add(n);
      }
    }
    return [...ids].sort((a, b) => a - b);
  });
}

/**
 * A card is "expanded" when the full CommentCard renders — that form has a
 * Resolve (or Reopen, if already resolved) button. Collapsed active comments
 * render only the avatar/name/text; collapsed resolved ones render the
 * checkmark marker (no data-comment-resolved on the full card either).
 */
async function isCommentExpanded(page: Page, commentId: number): Promise<boolean> {
  const card = commentCard(page, commentId);
  if ((await card.count()) === 0) return false;
  const actionBtn = card.locator('button[title="Resolve"], button[title="Reopen"]');
  return (await actionBtn.count()) > 0;
}

/**
 * Move the PM cursor to a position with no comment/tracked-change mark by
 * selecting a known-clean word (caller supplies one) and collapsing forward.
 * Using selectText rather than keyboard shortcuts avoids issues with the
 * hidden off-screen PM editor not receiving focus from editor.focus().
 */
async function moveCursorTo(editor: EditorPage, cleanWord: string) {
  const found = await editor.selectText(cleanWord);
  expect(found, `moveCursorTo: word "${cleanWord}" should be in the doc`).toBe(true);
  await editor.page.keyboard.press('ArrowRight');
  await editor.page.waitForTimeout(200);
}

async function setupEmptyDoc(page: Page): Promise<EditorPage> {
  const editor = new EditorPage(page);
  await editor.goto();
  await editor.waitForReady();
  await editor.newDocument();
  await editor.focus();
  return editor;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Comments sidebar — cursor-based expansion', () => {
  test('cursor entering a comment range expands its card, leaving collapses it', async ({
    page,
  }) => {
    const editor = await setupEmptyDoc(page);
    await openSidebar(page);
    await editor.typeText(`Alpha bravo charlie delta echo fox ${CLEAN}.`);

    await addCommentOn(editor, 'bravo', 'on bravo');
    const [id] = await getSidebarCommentIds(page);
    expect(id).toBeDefined();

    // Freshly submitted: cursor sits right after the comment range, expanded.
    expect(await isCommentExpanded(page, id)).toBe(true);

    // Move far away → collapses.
    await moveCursorTo(editor, CLEAN);
    expect(await isCommentExpanded(page, id)).toBe(false);

    // Move back onto the commented word → expands again.
    await editor.selectText('bravo');
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(200);
    expect(await isCommentExpanded(page, id)).toBe(true);
  });

  test('only one card is expanded at a time, driven by cursor position', async ({ page }) => {
    const editor = await setupEmptyDoc(page);
    await openSidebar(page);
    await editor.typeText(`Zero one two three four five six seven ${CLEAN}.`);

    await addCommentOn(editor, 'two', 'second');
    await addCommentOn(editor, 'five', 'fifth');

    const ids = await getSidebarCommentIds(page);
    expect(ids).toHaveLength(2);
    const [firstId, secondId] = ids;

    await editor.selectText('two');
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(200);
    expect(await isCommentExpanded(page, firstId)).toBe(true);
    expect(await isCommentExpanded(page, secondId)).toBe(false);

    await editor.selectText('five');
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(200);
    expect(await isCommentExpanded(page, firstId)).toBe(false);
    expect(await isCommentExpanded(page, secondId)).toBe(true);
  });

  test('arrow-key navigation into a comment expands its card', async ({ page }) => {
    const editor = await setupEmptyDoc(page);
    await openSidebar(page);
    await editor.typeText(`prefix commented suffix ${CLEAN}.`);

    await addCommentOn(editor, 'commented', 'kbd nav');
    const [id] = await getSidebarCommentIds(page);

    await moveCursorTo(editor, CLEAN);
    expect(await isCommentExpanded(page, id)).toBe(false);

    // Arrow-key navigation: start on "prefix", walk right until cursor lands
    // inside "commented". ArrowRight from a collapsed-after-selection point
    // advances one PM position at a time.
    await editor.selectText('prefix');
    await page.keyboard.press('ArrowRight'); // collapse to end of "prefix"
    await page.keyboard.press('ArrowRight'); // past space, into "commented"
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(200);
    expect(await isCommentExpanded(page, id)).toBe(true);
  });
});

test.describe('Comments sidebar — resolve / reopen (regression #268)', () => {
  test('clicking the resolved checkmark expands the card', async ({ page }) => {
    // Direct regression for #268: after Resolve + navigate away, clicking the
    // checkmark must re-expand the card. Before the fix, the ResizeObserver on
    // the editor container fired onSelectionChange with the unchanged cursor
    // right after the click set the expansion, clearing it within one frame.
    const editor = await setupEmptyDoc(page);
    await openSidebar(page);
    await editor.typeText(`Here is a resolvable target word in the doc ${CLEAN}.`);

    await addCommentOn(editor, 'target', 'resolve me');
    const [id] = await getSidebarCommentIds(page);

    await commentCard(page, id).locator('button[title="Resolve"]').click();
    await page.waitForTimeout(150);

    await moveCursorTo(editor, CLEAN);
    await page.waitForTimeout(200);

    const marker = resolvedMarker(page, id);
    await expect(marker).toBeVisible();

    await marker.click();
    await page.waitForTimeout(300);

    expect(await isCommentExpanded(page, id)).toBe(true);
    await expect(commentCard(page, id).locator('button[title="Reopen"]')).toBeVisible();
  });

  test('clicking the resolved checkmark expansion survives multiple resize frames', async ({
    page,
  }) => {
    // Harder version of the regression: make sure the expansion is not just
    // set-then-cleared, but stays across multiple render frames worth of
    // ResizeObserver/layout effect firings.
    const editor = await setupEmptyDoc(page);
    await openSidebar(page);
    await editor.typeText(`Persistence check with marker word here ${CLEAN}.`);

    await addCommentOn(editor, 'marker', 'persist');
    const [id] = await getSidebarCommentIds(page);

    await commentCard(page, id).locator('button[title="Resolve"]').click();
    await moveCursorTo(editor, CLEAN);
    await page.waitForTimeout(200);

    await resolvedMarker(page, id).click();

    for (let i = 0; i < 5; i++) {
      await page.waitForTimeout(100);
      expect(await isCommentExpanded(page, id), `still expanded after ${i * 100}ms`).toBe(true);
    }
  });

  test('clicking an expanded resolved card collapses it back to the checkmark', async ({
    page,
  }) => {
    const editor = await setupEmptyDoc(page);
    await openSidebar(page);
    await editor.typeText(`Toggle me on and off here ${CLEAN}.`);

    await addCommentOn(editor, 'Toggle', 'toggle test');
    const [id] = await getSidebarCommentIds(page);

    await commentCard(page, id).locator('button[title="Resolve"]').click();
    await moveCursorTo(editor, CLEAN);
    await page.waitForTimeout(200);

    await resolvedMarker(page, id).click();
    await page.waitForTimeout(200);
    expect(await isCommentExpanded(page, id)).toBe(true);

    // CommentCard root has onClick={onToggleExpand}. Click a safe spot (not on
    // the action buttons) to flip it closed.
    await commentCard(page, id).click({ position: { x: 10, y: 10 } });
    await page.waitForTimeout(200);

    expect(await isCommentExpanded(page, id)).toBe(false);
    await expect(resolvedMarker(page, id)).toBeVisible();
  });

  test('reopen converts a resolved comment back to a normal active comment', async ({ page }) => {
    const editor = await setupEmptyDoc(page);
    await openSidebar(page);
    await editor.typeText(`Resolve then reopen this phrase now ${CLEAN}.`);

    await addCommentOn(editor, 'phrase', 'reopen flow');
    const [id] = await getSidebarCommentIds(page);

    await commentCard(page, id).locator('button[title="Resolve"]').click();
    await moveCursorTo(editor, CLEAN);
    await page.waitForTimeout(200);

    await resolvedMarker(page, id).click();
    await page.waitForTimeout(200);
    await commentCard(page, id).locator('button[title="Reopen"]').click();
    await page.waitForTimeout(200);

    await expect(resolvedMarker(page, id)).toHaveCount(0);
    await expect(commentCard(page, id).locator('button[title="Resolve"]')).toBeVisible();
  });

  test('resolved comments remain visible as checkmarks while sidebar is open', async ({ page }) => {
    const editor = await setupEmptyDoc(page);
    await openSidebar(page);
    await editor.typeText(`Alpha beta gamma delta epsilon zeta eta theta ${CLEAN}.`);

    await addCommentOn(editor, 'beta', 'one');
    await addCommentOn(editor, 'delta', 'two');
    await addCommentOn(editor, 'zeta', 'three');

    const ids = await getSidebarCommentIds(page);
    expect(ids).toHaveLength(3);
    const midId = ids[1];

    await editor.selectText('delta');
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(150);
    await commentCard(page, midId).locator('button[title="Resolve"]').click();
    await moveCursorTo(editor, CLEAN);
    await page.waitForTimeout(200);

    await expect(resolvedMarker(page, midId)).toBeVisible();
    await expect(commentCard(page, ids[0])).toBeVisible();
    await expect(commentCard(page, ids[2])).toBeVisible();
  });

  test('cursor landing on a resolved comment range does not auto-expand its card', async ({
    page,
  }) => {
    // Resolved comments should stay collapsed to the checkmark marker unless
    // the user explicitly clicks the marker. Otherwise the sidebar is polluted
    // with old threads every time the cursor passes through commented text.
    const editor = await setupEmptyDoc(page);
    await openSidebar(page);
    await editor.typeText(`Before resolved word after ${CLEAN}.`);

    await addCommentOn(editor, 'resolved', 'to be resolved');
    const [id] = await getSidebarCommentIds(page);

    await commentCard(page, id).locator('button[title="Resolve"]').click();
    await moveCursorTo(editor, CLEAN);
    await page.waitForTimeout(200);
    await expect(resolvedMarker(page, id)).toBeVisible();

    // Move the cursor onto the still-marked "resolved" word. With an active
    // comment this would auto-expand the card; for a resolved comment it must
    // stay collapsed as the checkmark.
    await editor.selectText('resolved');
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(250);

    expect(await isCommentExpanded(page, id)).toBe(false);
    await expect(resolvedMarker(page, id)).toBeVisible();

    // Clicking the marker is still the way to open it.
    await resolvedMarker(page, id).click();
    await page.waitForTimeout(200);
    expect(await isCommentExpanded(page, id)).toBe(true);
  });

  test('clicking Resolve immediately collapses the card to the checkmark marker', async ({
    page,
  }) => {
    // Resolving without moving the cursor should not leave the expanded card
    // hanging — clicking Resolve is itself the "I'm done with this" action.
    const editor = await setupEmptyDoc(page);
    await openSidebar(page);
    await editor.typeText(`Collapse on resolve target word test ${CLEAN}.`);

    await addCommentOn(editor, 'target', 'to resolve');
    const [id] = await getSidebarCommentIds(page);
    expect(await isCommentExpanded(page, id)).toBe(true);

    // Resolve click — no cursor movement afterwards.
    await commentCard(page, id).locator('button[title="Resolve"]').click();
    await page.waitForTimeout(250);

    expect(await isCommentExpanded(page, id)).toBe(false);
    await expect(resolvedMarker(page, id)).toBeVisible();
  });

  test('resolved comment highlight is hidden in the doc body by default', async ({ page }) => {
    const editor = await setupEmptyDoc(page);
    await openSidebar(page);
    await editor.typeText(`Hide highlight for target when resolved ${CLEAN}.`);

    await addCommentOn(editor, 'target', 'hide highlight');
    const [id] = await getSidebarCommentIds(page);

    // Active comment: highlight is yellowish.
    const activeBg = await getCommentHighlight(page, id);
    expect(isYellowish(activeBg), `active bg "${activeBg}" should be yellowish`).toBe(true);

    // Resolve → card collapses → highlight hides.
    await commentCard(page, id).locator('button[title="Resolve"]').click();
    await page.waitForTimeout(300);
    const resolvedBg = await getCommentHighlight(page, id);
    expect(isYellowish(resolvedBg), `resolved bg "${resolvedBg}" should NOT be yellowish`).toBe(
      false
    );
  });

  test('expanding a resolved comment re-shows the highlight on its range only', async ({
    page,
  }) => {
    const editor = await setupEmptyDoc(page);
    await openSidebar(page);
    await editor.typeText(`Show on expand target word here ${CLEAN}.`);

    await addCommentOn(editor, 'target', 'show on expand');
    const [id] = await getSidebarCommentIds(page);

    await commentCard(page, id).locator('button[title="Resolve"]').click();
    await moveCursorTo(editor, CLEAN);
    await page.waitForTimeout(250);

    // Collapsed: highlight hidden.
    expect(isYellowish(await getCommentHighlight(page, id))).toBe(false);

    // Expand by clicking the checkmark: highlight should return.
    await resolvedMarker(page, id).click();
    await page.waitForTimeout(250);
    const expandedBg = await getCommentHighlight(page, id);
    expect(isYellowish(expandedBg), `expanded bg "${expandedBg}" should be yellowish`).toBe(true);
  });

  test('clicking the grey gutter outside the page collapses an expanded card', async ({ page }) => {
    const editor = await setupEmptyDoc(page);
    await openSidebar(page);
    await editor.typeText(`Gutter collapse target word here ${CLEAN}.`);

    await addCommentOn(editor, 'target', 'gutter test');
    const [id] = await getSidebarCommentIds(page);

    // Resolve then expand so we have a resolved card open — clicking the gutter
    // should collapse it back to the checkmark.
    await commentCard(page, id).locator('button[title="Resolve"]').click();
    await moveCursorTo(editor, CLEAN);
    await page.waitForTimeout(200);
    await resolvedMarker(page, id).click();
    await page.waitForTimeout(200);
    expect(await isCommentExpanded(page, id)).toBe(true);

    // Click in the grey area well outside the page and sidebar. The scroll
    // container extends left of the page; 20px from the viewport left edge is
    // reliably in the gutter.
    const pageEl = page.locator('.layout-page').first();
    const pageBox = await pageEl.boundingBox();
    if (!pageBox) throw new Error('page not found');
    await page.mouse.click(Math.max(20, pageBox.x - 40), pageBox.y + 50);
    await page.waitForTimeout(250);

    expect(await isCommentExpanded(page, id)).toBe(false);
    await expect(resolvedMarker(page, id)).toBeVisible();
  });

  test('toggling the sidebar off and on resets resolved comments to the checkmark default', async ({
    page,
  }) => {
    const editor = await setupEmptyDoc(page);
    await openSidebar(page);
    await editor.typeText(`Sidebar toggle reset target word ${CLEAN}.`);

    await addCommentOn(editor, 'target', 'toggle test');
    const [id] = await getSidebarCommentIds(page);

    // Resolve + expand so a resolved card is open right before toggling.
    await commentCard(page, id).locator('button[title="Resolve"]').click();
    await moveCursorTo(editor, CLEAN);
    await page.waitForTimeout(200);
    await resolvedMarker(page, id).click();
    await page.waitForTimeout(200);
    expect(await isCommentExpanded(page, id)).toBe(true);

    // Toggle sidebar off then back on.
    const toggle = page.locator('[aria-label="Toggle comments sidebar"]');
    await toggle.click();
    await page.waitForTimeout(150);
    await toggle.click();
    await page.waitForTimeout(250);

    // Resolved comment should be back to the checkmark, not the expanded card.
    await expect(resolvedMarker(page, id)).toBeVisible();
    expect(await isCommentExpanded(page, id)).toBe(false);
  });
});

test.describe('Comments sidebar — feedback-loop stability', () => {
  test('expanding a card does not immediately re-collapse (state-identity dedup)', async ({
    page,
  }) => {
    // When the sidebar expands, the editor container resizes → ResizeObserver
    // runs updateSelectionOverlay. Without state-identity dedup, the callback
    // fired with the unchanged cursor and cleared the expansion (#268). This
    // test verifies the card stays expanded across multiple resize frames.
    const editor = await setupEmptyDoc(page);
    await openSidebar(page);
    await editor.typeText(`Stability test text with target word here ${CLEAN}.`);

    await addCommentOn(editor, 'target', 'stable');
    const [id] = await getSidebarCommentIds(page);

    await moveCursorTo(editor, CLEAN);
    await page.waitForTimeout(200);

    await editor.selectText('target');
    await page.keyboard.press('ArrowRight');

    for (let i = 0; i < 5; i++) {
      await page.waitForTimeout(100);
      expect(await isCommentExpanded(page, id), `still expanded at ${i * 100}ms`).toBe(true);
    }
  });

  test('resize while a resolved card is expanded does not collapse it (ResizeObserver feedback)', async ({
    page,
  }) => {
    // Directly exercises the ResizeObserver path on the paged-editor container.
    // Before the state-identity dedup, updateSelectionOverlay fired every time
    // the container resized, invoking onSelectionChange with the unchanged
    // cursor and clearing the expansion that the marker click had just set.
    const editor = await setupEmptyDoc(page);
    await openSidebar(page);
    await editor.typeText(`Resize loop test with marker here ${CLEAN}.`);

    await addCommentOn(editor, 'marker', 'resize');
    const [id] = await getSidebarCommentIds(page);

    await commentCard(page, id).locator('button[title="Resolve"]').click();
    await moveCursorTo(editor, CLEAN);
    await page.waitForTimeout(200);

    await resolvedMarker(page, id).click();
    await page.waitForTimeout(150);
    expect(await isCommentExpanded(page, id)).toBe(true);

    // Force several ResizeObserver ticks by shrinking then restoring the
    // viewport. Each resize re-runs updateSelectionOverlay with the same
    // PM state; without dedup, each one re-invokes onSelectionChange and
    // clears the expansion.
    const original = page.viewportSize();
    await page.setViewportSize({ width: 900, height: 700 });
    await page.waitForTimeout(100);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForTimeout(100);
    if (original) await page.setViewportSize(original);
    await page.waitForTimeout(200);

    expect(await isCommentExpanded(page, id)).toBe(true);
  });

  test('clicking a collapsed card in the sidebar expands it without moving the cursor', async ({
    page,
  }) => {
    const editor = await setupEmptyDoc(page);
    await openSidebar(page);
    await editor.typeText(`Click the card safely one two three four ${CLEAN}.`);

    await addCommentOn(editor, 'two', 'click target');
    const [id] = await getSidebarCommentIds(page);

    await moveCursorTo(editor, CLEAN);
    await page.waitForTimeout(200);
    expect(await isCommentExpanded(page, id)).toBe(false);

    // Capture PM cursor position before the sidebar click.
    const posBefore = await page.evaluate(() => {
      const view = document.querySelector('.paged-editor__hidden-pm .ProseMirror');
      if (!view) return null;
      return window.getSelection()?.anchorOffset ?? null;
    });

    await commentCard(page, id).click({ position: { x: 10, y: 10 } });
    await page.waitForTimeout(250);

    expect(await isCommentExpanded(page, id)).toBe(true);

    const posAfter = await page.evaluate(() => {
      const view = document.querySelector('.paged-editor__hidden-pm .ProseMirror');
      if (!view) return null;
      return window.getSelection()?.anchorOffset ?? null;
    });
    // The click should not have moved the PM cursor (onMouseDown on the card
    // and sidebar root both stopPropagation to prevent cursor reposition).
    expect(posAfter).toEqual(posBefore);
  });
});

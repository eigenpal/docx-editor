/**
 * Tracked structural changes — paragraph-mark insertion/deletion (issue #614).
 *
 * Verifies that pressing Enter in suggesting mode produces a tracked
 * paragraph-mark insertion (`pPrIns`) on the FIRST of the two resulting
 * paragraphs, and that Backspace at the start of a paragraph produces a
 * tracked paragraph-mark deletion (`pPrDel`) on the previous paragraph —
 * not an untracked structural edit. Then exercises accept/reject by id.
 *
 * Background: https://github.com/eigenpal/docx-editor/issues/614
 */

import { test, expect } from '@playwright/test';
import { EditorPage } from '../helpers/editor-page';

type ParagraphRevision = {
  pPrIns: { revisionId: number; author: string; date: string | null } | null;
  pPrDel: { revisionId: number; author: string; date: string | null } | null;
};

async function getParaRevision(
  page: import('@playwright/test').Page,
  index: number
): Promise<ParagraphRevision | null> {
  return page.evaluate((i) => {
    const hook = window.__DOCX_EDITOR_E2E__;
    return hook?.getParagraphRevisionAt(i) ?? null;
  }, index);
}

async function getParagraphAttrs(
  page: import('@playwright/test').Page,
  index: number
): Promise<Record<string, unknown> | null> {
  return page.evaluate((i) => {
    const hook = window.__DOCX_EDITOR_E2E__;
    return hook?.getParagraphAttrs?.(i) ?? null;
  }, index);
}

async function setSuggestionMode(
  page: import('@playwright/test').Page,
  active: boolean,
  author?: string
) {
  const ok = await page.evaluate(
    ({ a, u }) => window.__DOCX_EDITOR_E2E__?.setSuggestionMode(a, u) ?? false,
    { a: active, u: author }
  );
  // Re-focus the editor: the meta dispatch can trigger a React re-render
  // path that briefly loses contentEditable focus, which makes subsequent
  // page.keyboard.press('Backspace') target the wrong element.
  await page.locator('.ProseMirror').first().focus();
  return ok;
}

async function acceptById(page: import('@playwright/test').Page, id: number) {
  return page.evaluate((rid) => window.__DOCX_EDITOR_E2E__?.acceptChangeById(rid) ?? false, id);
}

async function rejectById(page: import('@playwright/test').Page, id: number) {
  return page.evaluate((rid) => window.__DOCX_EDITOR_E2E__?.rejectChangeById(rid) ?? false, id);
}

test.describe('Tracked paragraph-mark revisions (issue #614)', () => {
  let editor: EditorPage;

  test.beforeEach(async ({ page }) => {
    editor = new EditorPage(page);
    await editor.gotoEmpty();
    await editor.waitForReady();
    await editor.focus();
  });

  test('Enter in suggesting mode sets pPrIns on the first paragraph', async ({ page }) => {
    await editor.typeText('Hello world');
    // Move caret to between "Hello" and " world".
    await editor.selectRange(0, 0, 5);
    await page.keyboard.press('ArrowRight'); // collapse to end of selection
    expect(await setSuggestionMode(page, true, 'Jane')).toBe(true);

    await editor.pressEnter();

    const first = await getParaRevision(page, 0);
    const second = await getParaRevision(page, 1);

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();

    // First paragraph (the new pilcrow) carries pPrIns.
    expect(first?.pPrIns).not.toBeNull();
    expect(first?.pPrIns?.author).toBe('Jane');
    expect(first?.pPrDel).toBeNull();
    // Second paragraph carries no new revision attr.
    expect(second?.pPrIns).toBeNull();
    expect(second?.pPrDel).toBeNull();
  });

  test('Backspace at paragraph start in suggesting mode sets pPrDel on previous paragraph', async ({
    page,
  }) => {
    await editor.typeText('Hello');
    await editor.pressEnter();
    await editor.typeText('world');
    // Place caret at start of "world".
    await page.keyboard.press('Home');

    expect(await setSuggestionMode(page, true, 'Jane')).toBe(true);
    await page.keyboard.press('Backspace');
    // Wait for React/PM to flush the Backspace transaction before reading attrs.
    await page.waitForTimeout(150);

    // Paragraphs still split — the join is DEFERRED until accept.
    const first = await getParaRevision(page, 0);
    const second = await getParaRevision(page, 1);
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();

    expect(first?.pPrDel).not.toBeNull();
    expect(first?.pPrDel?.author).toBe('Jane');
    expect(first?.pPrIns).toBeNull();
    expect(second?.pPrDel).toBeNull();
  });

  test('Backspace at the very start of the document is a no-op', async ({ page }) => {
    await editor.typeText('only paragraph');
    await page.keyboard.press('Home');

    expect(await setSuggestionMode(page, true)).toBe(true);
    await page.keyboard.press('Backspace');

    const first = await getParaRevision(page, 0);
    expect(first?.pPrIns).toBeNull();
    expect(first?.pPrDel).toBeNull();
  });

  test('Accept pPrIns clears the marker; paragraphs stay split', async ({ page }) => {
    await editor.typeText('Hello world');
    await editor.selectRange(0, 0, 5);
    await page.keyboard.press('ArrowRight');
    await setSuggestionMode(page, true, 'Jane');
    await editor.pressEnter();

    const before = await getParaRevision(page, 0);
    const revId = before?.pPrIns?.revisionId;
    expect(typeof revId).toBe('number');

    expect(await acceptById(page, revId as number)).toBe(true);

    const first = await getParaRevision(page, 0);
    const second = await getParaRevision(page, 1);
    expect(first?.pPrIns).toBeNull();
    expect(second).not.toBeNull(); // still split
  });

  test('Reject pPrIns joins the two paragraphs back together', async ({ page }) => {
    await editor.typeText('Hello world');
    await editor.selectRange(0, 0, 5);
    await page.keyboard.press('ArrowRight');
    await setSuggestionMode(page, true, 'Jane');
    await editor.pressEnter();

    const before = await getParaRevision(page, 0);
    const revId = before?.pPrIns?.revisionId as number;

    expect(await rejectById(page, revId)).toBe(true);

    const first = await getParaRevision(page, 0);
    const second = await getParaRevision(page, 1);
    expect(first?.pPrIns).toBeNull();
    expect(second).toBeNull(); // second paragraph gone — join happened
  });

  test('Accept pPrDel joins the paragraphs (matches Word)', async ({ page }) => {
    await editor.typeText('Hello');
    await editor.pressEnter();
    await editor.typeText('world');
    await page.keyboard.press('Home');

    await setSuggestionMode(page, true, 'Jane');
    await page.keyboard.press('Backspace');
    // Wait for React to flush the Backspace transaction. Without this the
    // `getParaRevision` read can race against the dispatch and see stale attrs.
    await page.waitForTimeout(150);

    const before = await getParaRevision(page, 0);
    expect(before?.pPrDel, 'Backspace must set pPrDel on previous paragraph').not.toBeNull();
    const revId = before?.pPrDel?.revisionId as number;

    expect(await acceptById(page, revId)).toBe(true);

    const first = await getParaRevision(page, 0);
    const second = await getParaRevision(page, 1);
    expect(first?.pPrDel).toBeNull();
    expect(second).toBeNull();
  });

  test('Reject pPrDel clears the marker; paragraphs stay split', async ({ page }) => {
    await editor.typeText('Hello');
    await editor.pressEnter();
    await editor.typeText('world');
    await page.keyboard.press('Home');

    await setSuggestionMode(page, true, 'Jane');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(150);

    const before = await getParaRevision(page, 0);
    expect(before?.pPrDel, 'Backspace must set pPrDel on previous paragraph').not.toBeNull();
    const revId = before?.pPrDel?.revisionId as number;

    expect(await rejectById(page, revId)).toBe(true);

    const first = await getParaRevision(page, 0);
    const second = await getParaRevision(page, 1);
    expect(first?.pPrDel).toBeNull();
    expect(second).not.toBeNull();
  });

  test('Painted paragraph fragments carry data-revision-id and the pilcrow class', async ({
    page,
  }) => {
    await editor.typeText('Hello world');
    await editor.selectRange(0, 0, 5);
    await page.keyboard.press('ArrowRight');
    await setSuggestionMode(page, true, 'Jane');
    await editor.pressEnter();

    // The painter renders into .layout-paragraph fragments. The first
    // fragment of the inserted paragraph should carry the revision attrs
    // and the layout-revision-ins class.
    const insMark = page
      .locator('.layout-paragraph.layout-revision-pmark.layout-revision-ins')
      .first();
    await expect(insMark).toBeVisible();
    const revId = await insMark.getAttribute('data-revision-id');
    expect(revId).toMatch(/^\d+$/);
    expect(await insMark.getAttribute('data-revision-author')).toBe('Jane');

    // The pilcrow glyph must sit INSIDE the last line element (inline with
    // text), not as a sibling block after all the line divs. Otherwise it
    // renders as its own row below the text and visually overlaps the next
    // paragraph (regression check for the fragment-::after layout bug).
    const glyph = insMark.locator('.layout-revision-pmark-glyph').first();
    await expect(glyph).toBeVisible();
    await expect(glyph).toHaveText('¶');
    // Glyph's parent must be a .layout-line (the last line of the fragment),
    // NOT the fragment itself.
    const parentClass = await glyph.evaluate((el) => el.parentElement?.className ?? '');
    expect(parentClass).toContain('layout-line');
  });

  test('acceptChangeById on an unknown revisionId is a no-op (returns false)', async ({ page }) => {
    await editor.typeText('untouched');
    expect(await acceptById(page, 999999)).toBe(false);
  });

  test('pPrChange round-trips and reject restores prior alignment', async ({ page }) => {
    // Manually plant a pPrChange entry via the PM view, then verify
    // acceptChangeById clears it and rejectChangeById restores prior fields.
    await editor.typeText('Hello');
    await page.evaluate(() => {
      const w = window as unknown as {
        __DOCX_EDITOR_E2E__?: {
          plantParagraphPropertyChange?: (revisionId: number, prior: unknown) => boolean;
        };
      };
      w.__DOCX_EDITOR_E2E__?.plantParagraphPropertyChange?.(99, {
        alignment: 'left',
        indentLeft: 0,
      });
    });
    // (test-only helper — see App.tsx; falls through if not present)
    // Sanity: the pPrChange attr is present.
    const before = await getParagraphAttrs(page, 0);
    // The helper IS wired in examples/vite/src/App.tsx; assert presence rather
    // than skipping, so a future regression of the helper surfaces here.
    expect(before, 'plantParagraphPropertyChange helper must populate pPrChange').toBeTruthy();
    expect(before?.pPrChange).toBeTruthy();
    // Reject restores `alignment: 'left'` via applyPriorParagraphFormattingToAttrs.
    const ok = await rejectById(page, 99);
    expect(ok).toBe(true);
    const after = await getParagraphAttrs(page, 0);
    expect(after).not.toBeNull();
    expect(after?.pPrChange).toBeNull();
    expect(after?.alignment).toBe('left');
  });

  test('reject of a reloaded list-creation pPrChange clears numbering (issue #634)', async ({
    page,
  }) => {
    // Simulate the post-save/reload state of a list created in suggesting mode:
    // the paragraph IS a list (numPr set), and its pPrChange has an EMPTY prior
    // (the `<w:pPr/>` Word writes) but a `currentFormatting` carrying numPr (as
    // the parser repopulates on load). Reject must still strip the numbering —
    // otherwise the lingering item returns after a round-trip.
    await editor.typeText('Item');
    await page.evaluate(() => {
      const w = window as unknown as {
        __DOCX_EDITOR_E2E__?: {
          plantParagraphPropertyChange?: (
            revisionId: number,
            prior: unknown,
            current?: unknown,
            paraAttrs?: Record<string, unknown>
          ) => boolean;
        };
      };
      w.__DOCX_EDITOR_E2E__?.plantParagraphPropertyChange?.(
        77,
        {}, // empty prior — round-tripped <w:pPr/>
        { numPr: { numId: 2, ilvl: 0 } }, // current snapshot the parser rebuilds
        { numPr: { numId: 2, ilvl: 0 }, listIsBullet: false, listNumFmt: 'decimal' }
      );
    });

    const before = await getParagraphAttrs(page, 0);
    expect(before?.numPr, 'planted paragraph must be a list').toBeTruthy();
    expect(before?.pPrChange).toBeTruthy();

    expect(await rejectById(page, 77)).toBe(true);

    const after = await getParagraphAttrs(page, 0);
    expect(after?.pPrChange).toBeNull();
    expect(after?.numPr ?? null, 'numbering must be removed on reject').toBeNull();
    expect(after?.listIsBullet ?? null, 'derived list attrs must be cleared too').toBeNull();
  });

  test('trIns round-trips and acceptChangeById clears the marker on the row', async ({ page }) => {
    // Plant a 1×1 table at the cursor via PM dispatch, then plant trIns on
    // the row and verify acceptChangeById clears it.
    await page.evaluate(() => window.__DOCX_EDITOR_E2E__?.plantSimpleTable?.());
    const planted = await page.evaluate(
      () => window.__DOCX_EDITOR_E2E__?.plantTableRowInsertion?.(77) ?? false
    );
    expect(planted, 'plantTableRowInsertion must populate trIns on the first row').toBe(true);

    const rowAttrs = await page.evaluate(
      () => window.__DOCX_EDITOR_E2E__?.getFirstTableRowAttrs?.() ?? null
    );
    expect(rowAttrs?.trIns).toBeTruthy();
    expect((rowAttrs?.trIns as { revisionId: number }).revisionId).toBe(77);

    // The PAINTER reads trIns from the layout model and surfaces the
    // tracking on the visible DOM (so the change bar shows + sidebar can
    // anchor cards). When EVERY row of the table shares the same trIns
    // id (single-row table here), the painter promotes the bar to the
    // table element itself (`.layout-table.ep-revision-table`) and
    // suppresses the per-row class to avoid double-painting. Either
    // surface carries the same `data-revision-id`.
    const paintedTracked = page.locator(
      '.layout-table.ep-revision-table[data-revision-id], .layout-table-row.ep-revision-row[data-revision-id]'
    );
    await expect(paintedTracked.first()).toBeVisible();
    expect(await paintedTracked.first().getAttribute('data-revision-id')).toBe('77');

    // Accept clears the marker (Phase 2 round-trip semantic; full row-remove
    // semantics come with suggesting-aware commands).
    expect(await acceptById(page, 77)).toBe(true);
    const afterAttrs = await page.evaluate(
      () => window.__DOCX_EDITOR_E2E__?.getFirstTableRowAttrs?.() ?? null
    );
    expect(afterAttrs?.trIns).toBeNull();
  });

  test('addRowBelow in suggesting mode tracks the new row via trIns', async ({ page }) => {
    await page.evaluate(() => window.__DOCX_EDITOR_E2E__?.plantSimpleTable?.());
    expect(await page.evaluate(() => window.__DOCX_EDITOR_E2E__?.countTableRows?.() ?? 0)).toBe(1);

    expect(await setSuggestionMode(page, true, 'Jane')).toBe(true);
    expect(await page.evaluate(() => window.__DOCX_EDITOR_E2E__?.focusFirstTableCell?.())).toBe(
      true
    );

    expect(await page.evaluate(() => window.__DOCX_EDITOR_E2E__?.addRowBelow?.())).toBe(true);
    await page.waitForTimeout(50);

    // Two rows now; only the new one carries `trIns`.
    expect(await page.evaluate(() => window.__DOCX_EDITOR_E2E__?.countTableRows?.() ?? 0)).toBe(2);

    // The painted row carries `data-revision-id` via tableRowSpec.toDOM
    // (set when `trIns` is non-null). Grab the id from there.
    const trIns = page.locator('tr[data-revision-id]').first();
    await expect(trIns).toBeVisible();
    const revIdStr = await trIns.getAttribute('data-revision-id');
    const revId = parseInt(revIdStr ?? '', 10);
    expect(Number.isFinite(revId)).toBe(true);
    expect(await trIns.getAttribute('data-revision-author')).toBe('Jane');

    // Accept clears the marker; the row stays.
    expect(await acceptById(page, revId)).toBe(true);
    await page.waitForTimeout(50);
    expect(await page.evaluate(() => window.__DOCX_EDITOR_E2E__?.countTableRows?.() ?? 0)).toBe(2);
    await expect(page.locator('tr[data-revision-id]')).toHaveCount(0);
  });

  test('deleteRow in suggesting mode marks the row via trDel without removing it', async ({
    page,
  }) => {
    // Build a 2-row table so deleteRow has something to delete (it requires
    // rowCount > 1).
    await page.evaluate(() => window.__DOCX_EDITOR_E2E__?.plantSimpleTable?.());
    await setSuggestionMode(page, false); // ensure addRow doesn't track
    await page.evaluate(() => window.__DOCX_EDITOR_E2E__?.focusFirstTableCell?.());
    await page.evaluate(() => window.__DOCX_EDITOR_E2E__?.addRowBelow?.());
    await page.waitForTimeout(30);
    expect(await page.evaluate(() => window.__DOCX_EDITOR_E2E__?.countTableRows?.() ?? 0)).toBe(2);

    // Now turn on suggesting mode and delete the focused row. The row
    // should STAY (clear-only-on-accept Phase 2) but carry trDel.
    await setSuggestionMode(page, true, 'Jane');
    await page.evaluate(() => window.__DOCX_EDITOR_E2E__?.focusFirstTableCell?.());
    expect(await page.evaluate(() => window.__DOCX_EDITOR_E2E__?.deleteCurrentRow?.())).toBe(true);
    await page.waitForTimeout(50);

    expect(await page.evaluate(() => window.__DOCX_EDITOR_E2E__?.countTableRows?.() ?? 0)).toBe(2);
    const trDel = page.locator('tr.ep-revision-del').first();
    await expect(trDel).toBeVisible();
    expect(await trDel.getAttribute('data-revision-author')).toBe('Jane');
  });

  test('A typing run with Enters in the middle coalesces into one revision', async ({ page }) => {
    // The full "best practice" scenario: in suggesting mode, type "abc",
    // press Enter, type "def", press Enter, type "ghi". All inline insertion
    // marks AND both pPrIns paragraph-marks should share the SAME revisionId
    // so the sidebar shows ONE card and ONE Accept clears the whole run.
    expect(await setSuggestionMode(page, true, 'Jane')).toBe(true);
    await editor.typeText('abc');
    await editor.pressEnter();
    await editor.typeText('def');
    await editor.pressEnter();
    await editor.typeText('ghi');
    await page.waitForTimeout(50);

    // Collect every revisionId visible in the painted DOM — both pilcrow
    // fragments (.layout-revision-pmark) and inline insertion runs
    // (.docx-insertion). If coalescing works, all share one id.
    const ids = await page.$$eval(
      '.layout-revision-pmark[data-revision-id], .docx-insertion[data-revision-id]',
      (els) =>
        els.map((el) => Number((el as HTMLElement).dataset.revisionId)).filter(Number.isFinite)
    );
    expect(ids.length).toBeGreaterThanOrEqual(4); // 2 pilcrows + 3 typed runs
    expect(new Set(ids).size).toBe(1);

    // One Accept clears every coalesced site.
    expect(await acceptById(page, ids[0])).toBe(true);
    await page.waitForTimeout(50);
    expect(
      await page
        .locator('.layout-revision-pmark[data-revision-id], .docx-insertion[data-revision-id]')
        .count()
    ).toBe(0);
  });

  test('Replace selection plus added paragraphs share one revisionId', async ({ page }) => {
    // The user's "best practice" scenario: type baseline text, then in
    // suggesting mode select-all + retype + Enter + type + Enter + type.
    // All deletion + insertion + paragraph-mark sites should share ONE
    // revisionId so the sidebar shows ONE card and ONE Accept clears the
    // whole continuous edit (matches Word's grouping by author + session).
    await editor.typeText('original text here');
    expect(await setSuggestionMode(page, true, 'Jane')).toBe(true);
    await page.keyboard.press('Meta+a');
    await editor.typeText('replacement');
    await editor.pressEnter();
    await editor.typeText('paragraph two');
    await editor.pressEnter();
    await editor.typeText('paragraph three');
    await page.waitForTimeout(100);

    const distinctIds = await page.$$eval('[data-revision-id]', (els) => {
      const ids = els
        .filter((el) => (el as HTMLElement).dataset.revisionAuthor === 'Jane')
        .map((el) => (el as HTMLElement).dataset.revisionId);
      return [...new Set(ids)];
    });
    expect(
      distinctIds.length,
      'one continuous editing run by one author should produce one revisionId'
    ).toBe(1);
  });

  test('One Accept click clears a replace + multi-paragraph coalesced run', async ({ page }) => {
    // Regression: the replacement card was dispatching range-based accept,
    // which only cleared marks within (from, to). pPrIns attrs at adjacent
    // paragraphs sharing the same revisionId stayed behind so the user
    // saw a leftover "Inserted paragraph break" card and had to Accept
    // a second time. By-id dispatch clears every site in one pass.
    await editor.typeText('baseline text');
    expect(await setSuggestionMode(page, true, 'Jane')).toBe(true);
    await page.keyboard.press('Meta+a');
    await editor.typeText('replaced');
    await editor.pressEnter();
    await editor.typeText('second');
    await editor.pressEnter();
    await editor.typeText('third');
    await page.waitForTimeout(100);

    const toggle = page.locator('[aria-label="Toggle comments sidebar"]');
    if ((await toggle.getAttribute('aria-pressed')) !== 'true') {
      await toggle.click();
      await page.waitForTimeout(150);
    }

    await expect(page.locator('.docx-tracked-change-card')).toHaveCount(1);

    await page.locator('.docx-tracked-change-card button[title="Accept"]').first().click();
    await page.waitForTimeout(200);

    await expect(page.locator('.docx-tracked-change-card')).toHaveCount(0);
    expect(await page.locator('[data-revision-id]').count()).toBe(0);
  });

  test('Reject of a list created in suggesting mode leaves no lingering item (issue #634)', async ({
    page,
  }) => {
    // Apply a numbered list to a pre-existing empty paragraph, then type a
    // few items. The numbering change on the pre-existing paragraph is a
    // tracked pPrChange that folds into the one insertion card; Reject must
    // clear the text AND revert the numbering, leaving a single plain
    // paragraph — not a stranded empty list item.
    expect(await setSuggestionMode(page, true, 'Jane')).toBe(true);
    await editor.toggleNumberedList();
    await editor.typeText('one');
    await editor.pressEnter();
    await editor.typeText('two');
    await editor.pressEnter();
    await editor.typeText('three');
    await page.waitForTimeout(100);

    // The list marker paints in the insertion color while the numbering is a
    // pending suggestion (Word shows an inserted list item's number tracked).
    const markerColor = await page
      .locator('.layout-list-marker')
      .first()
      .evaluate((el) => (el as HTMLElement).style.color);
    expect(markerColor).toBe('rgb(46, 125, 50)');

    const toggle = page.locator('[aria-label="Toggle comments sidebar"]');
    if ((await toggle.getAttribute('aria-pressed')) !== 'true') {
      await toggle.click();
      await page.waitForTimeout(150);
    }

    // One card — the numbering pPrChange folds into the insertion.
    await expect(page.locator('.docx-tracked-change-card')).toHaveCount(1);

    await page.locator('.docx-tracked-change-card button[title="Reject"]').first().click();
    await page.waitForTimeout(200);

    // No tracked changes remain anywhere.
    await expect(page.locator('.docx-tracked-change-card')).toHaveCount(0);
    expect(await page.locator('[data-revision-id]').count()).toBe(0);

    // Exactly one paragraph, and it is no longer a list.
    const first = await getParagraphAttrs(page, 0);
    const second = await getParagraphAttrs(page, 1);
    expect(second, 'all inserted list items should be gone').toBeNull();
    expect(first?.numPr ?? null, 'numbering must be reverted by the pPrChange').toBeNull();
    expect(first?.pPrChange ?? null, 'the tracked numbering change must be cleared').toBeNull();
  });

  test('Accept of a list created in suggesting mode keeps it as a plain list (issue #634)', async ({
    page,
  }) => {
    expect(await setSuggestionMode(page, true, 'Jane')).toBe(true);
    await editor.toggleNumberedList();
    await editor.typeText('alpha');
    await editor.pressEnter();
    await editor.typeText('beta');
    await page.waitForTimeout(100);

    const toggle = page.locator('[aria-label="Toggle comments sidebar"]');
    if ((await toggle.getAttribute('aria-pressed')) !== 'true') {
      await toggle.click();
      await page.waitForTimeout(150);
    }

    await expect(page.locator('.docx-tracked-change-card')).toHaveCount(1);
    await page.locator('.docx-tracked-change-card button[title="Accept"]').first().click();
    await page.waitForTimeout(200);

    await expect(page.locator('.docx-tracked-change-card')).toHaveCount(0);
    expect(await page.locator('[data-revision-id]').count()).toBe(0);

    // The list survives, with no leftover tracked numbering change.
    const first = await getParagraphAttrs(page, 0);
    expect((first?.numPr as { numId?: number } | null)?.numId, 'list is kept on accept').toBe(2);
    expect(first?.pPrChange ?? null, 'pPrChange entry is cleared on accept').toBeNull();

    // The marker is now a plain list marker — no revision color.
    const markerColor = await page
      .locator('.layout-list-marker')
      .first()
      .evaluate((el) => (el as HTMLElement).style.color);
    expect(markerColor).toBe('');
  });

  test('Backspace on own pPrIns retracts the paragraph break (joins back)', async ({ page }) => {
    // Word semantic: pressing Backspace at the start of a paragraph
    // whose `pPrIns` was JUST authored by the same user retracts the
    // insertion (joins paragraphs) rather than stacking a pPrDel mark
    // on top. Mirrors the inline "retract own typed character" path.
    expect(await setSuggestionMode(page, true, 'Jane')).toBe(true);
    await editor.typeText('abc');
    await editor.pressEnter();
    await editor.pressEnter();
    await editor.pressEnter();
    await page.waitForTimeout(100);
    const paragraphsBefore = await page.locator('.layout-paragraph').count();
    expect(paragraphsBefore).toBe(4);

    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(150);

    const paragraphsAfter = await page.locator('.layout-paragraph').count();
    expect(paragraphsAfter).toBe(1);
    expect(await page.locator('.ProseMirror').textContent()).toBe('abc');
  });

  test('Undo of tracked Enters does not mark existing text as inserted (issue #633)', async ({
    page,
  }) => {
    // Repro: in suggesting mode, press Enter several times in the MIDDLE of
    // pre-existing (untracked) text, then undo. Undo must simply remove the
    // tracked paragraph break — it must NOT mark any pre-existing character
    // as inserted. Regression: the catch-all appendTransaction re-processed
    // the undo transaction's structural steps and stamped a stray `insertion`
    // mark on the boundary character.
    await editor.typeText('abcdef');
    // Move caret into the middle: between "abc" and "def".
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');

    expect(await setSuggestionMode(page, true, 'Jane')).toBe(true);
    await editor.pressEnter();
    await editor.pressEnter();
    await editor.pressEnter();
    await page.waitForTimeout(100);

    // The text predates suggesting mode and only paragraph breaks were
    // tracked — no inline insertion marks should exist yet.
    expect(await page.locator('.docx-insertion').count()).toBe(0);

    await editor.undo();
    await page.waitForTimeout(100);

    // After undo, still no character marked as inserted (the bug produced a
    // stray "Added 'd'" insertion on the boundary character), and the text
    // is intact.
    expect(await page.locator('.docx-insertion').count()).toBe(0);
    expect(await page.locator('.ProseMirror').textContent()).toBe('abcdef');
  });

  test('Inserting a table in suggesting mode shows one "Inserted table" card', async ({ page }) => {
    // OOXML model: every row gets <w:trPr><w:ins/></w:trPr> and every cell
    // gets <w:cellIns/> with the SAME w:id. Sidebar synthesizes one
    // 'tableInserted' entry from the per-row entries because they share an
    // id (matches Word's mental model: insert table = one card, edit
    // content = separate cards).
    expect(await setSuggestionMode(page, true, 'Jane')).toBe(true);
    expect(
      await page.evaluate(() => window.__DOCX_EDITOR_E2E__?.insertTable?.(3, 2) ?? false)
    ).toBe(true);
    await page.waitForTimeout(150);

    const toggle = page.locator('[aria-label="Toggle comments sidebar"]');
    if ((await toggle.getAttribute('aria-pressed')) !== 'true') {
      await toggle.click();
      await page.waitForTimeout(150);
    }

    // ONE card, labeled "Inserted table" (not "Inserted row").
    const cards = page.locator('.docx-tracked-change-card');
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toContainText('Inserted table');

    // Expand the card (Accept/Reject only render when expanded), then accept.
    await cards.first().click();
    await page.waitForTimeout(150);
    await page.locator('.docx-tracked-change-card button[title="Accept"]').first().click();
    await page.waitForTimeout(200);
    await expect(cards).toHaveCount(0);
    expect(await page.locator('.layout-table-row.ep-revision-row').count()).toBe(0);
    expect(await page.locator('.layout-table-row').count()).toBe(3);
  });

  test('Tracked typing + Enter inside a table cell coalesces into one revision', async ({
    page,
  }) => {
    // Tables nest paragraphs inside cells. The cross-block coalesce lookup
    // walks descendants of the adjacent block, so typing + Enter inside a
    // single cell must collapse to one revisionId the same way it does at
    // the document root.
    await page.evaluate(() => window.__DOCX_EDITOR_E2E__?.plantSimpleTable?.());
    await page.evaluate(() => window.__DOCX_EDITOR_E2E__?.focusFirstTableCell?.());
    expect(await setSuggestionMode(page, true, 'Jane')).toBe(true);
    await editor.typeText('cell typed');
    await editor.pressEnter();
    await editor.typeText('more in cell');
    await page.waitForTimeout(100);

    const distinctIds = await page.$$eval('[data-revision-id]', (els) => {
      const ids = els
        .filter((el) => (el as HTMLElement).dataset.revisionAuthor === 'Jane')
        .map((el) => (el as HTMLElement).dataset.revisionId);
      return [...new Set(ids)];
    });
    expect(distinctIds.length).toBe(1);
  });

  test('Consecutive Enters by the same author coalesce into one revision', async ({ page }) => {
    // Word groups a run of tracked paragraph-mark insertions by the same
    // author into one change. The sidebar should show ONE card for three
    // Enters and one Accept should resolve all three.
    await editor.typeText('first');
    expect(await setSuggestionMode(page, true, 'Jane')).toBe(true);
    await editor.pressEnter();
    await editor.typeText('second');
    await editor.pressEnter();
    await editor.typeText('third');
    await editor.pressEnter();

    const ids = await page.evaluate(() => {
      const w = window as unknown as {
        __DOCX_EDITOR_E2E__?: {
          getParagraphAttrs?: (i: number) => Record<string, unknown> | null;
        };
      };
      const collected: number[] = [];
      for (let i = 0; i < 4; i += 1) {
        const attrs = w.__DOCX_EDITOR_E2E__?.getParagraphAttrs?.(i);
        const ins = attrs?.pPrIns as { revisionId: number } | null | undefined;
        if (ins) collected.push(ins.revisionId);
      }
      return collected;
    });

    expect(ids.length).toBeGreaterThanOrEqual(3);
    // All three pPrIns markers share the same revisionId.
    expect(new Set(ids).size).toBe(1);

    // One Accept removes the marker from every coalesced paragraph.
    expect(await acceptById(page, ids[0])).toBe(true);
    const after = await page.evaluate(() => {
      const w = window as unknown as {
        __DOCX_EDITOR_E2E__?: {
          getParagraphAttrs?: (i: number) => Record<string, unknown> | null;
        };
      };
      const remaining: unknown[] = [];
      for (let i = 0; i < 4; i += 1) {
        const attrs = w.__DOCX_EDITOR_E2E__?.getParagraphAttrs?.(i);
        if (attrs?.pPrIns) remaining.push(attrs.pPrIns);
      }
      return remaining;
    });
    expect(after).toEqual([]);
  });

  test('acceptAllChanges resolves inline + paragraph-mark + table-row revisions in one call', async ({
    page,
  }) => {
    // Mixed-revision scenario: inline insertion (typed text) + paragraph-mark
    // insertion (Enter) + table-row insertion (planted). acceptAllChanges
    // should clear all three by iterating the snapshotted id list.
    expect(await setSuggestionMode(page, true, 'Jane')).toBe(true);
    await editor.typeText('Hello');
    await editor.pressEnter();
    await editor.typeText('World');
    await setSuggestionMode(page, false);

    // Plant a table with a tracked-row insertion at the end.
    await page.evaluate(() => window.__DOCX_EDITOR_E2E__?.plantSimpleTable?.());
    expect(
      await page.evaluate(() => window.__DOCX_EDITOR_E2E__?.plantTableRowInsertion?.(999))
    ).toBe(true);

    // Inline insertion mark, paragraph-mark revision, and row revision all
    // present before acceptAll.
    expect(await page.locator('.docx-insertion').count()).toBeGreaterThan(0);
    expect((await getParaRevision(page, 0))?.pPrIns).toBeTruthy();
    expect(await page.locator('tr[data-revision-id]').count()).toBeGreaterThan(0);

    const accepted = await page.evaluate(
      () => window.__DOCX_EDITOR_E2E__?.acceptAllChanges?.() ?? false
    );
    expect(accepted).toBe(true);

    // All tracking is gone after acceptAll.
    await page.waitForTimeout(50);
    expect(await page.locator('.docx-insertion').count()).toBe(0);
    expect(await page.locator('tr[data-revision-id]').count()).toBe(0);
    const para0 = await getParaRevision(page, 0);
    const para1 = await getParaRevision(page, 1);
    expect(para0?.pPrIns).toBeNull();
    expect(para1?.pPrIns).toBeNull();
  });

  test('Sidebar surfaces a paragraph-mark revision card with accept/reject', async ({ page }) => {
    await editor.typeText('Hello world');
    await editor.selectRange(0, 0, 5);
    await page.keyboard.press('ArrowRight');
    await setSuggestionMode(page, true, 'Jane');
    await editor.pressEnter();

    // Open the unified sidebar so revision cards render.
    const toggle = page.locator('[aria-label="Toggle comments sidebar"]');
    if ((await toggle.getAttribute('aria-pressed')) !== 'true') {
      await toggle.click();
      await page.waitForTimeout(150);
    }

    // The new TrackedChangeCard uses the existing `.docx-tracked-change-card`
    // class — confirm an entry shows up for the paragraph-mark revision.
    const card = page.locator('.docx-unified-sidebar .docx-tracked-change-card').first();
    await expect(card).toBeVisible();
    await expect(card).toContainText('Jane');
    await expect(card).toContainText('Inserted paragraph break');
  });
});

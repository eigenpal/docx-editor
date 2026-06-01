/**
 * Content-control (SDT) addressing on the editor ref, end to end through the
 * live editor: discover controls by tag, fill one, remove one, and scroll to
 * one. Drives the `window.__DOCX_EDITOR_E2E__` hooks that wrap the public
 * `DocxEditorRef` content-control methods, against the comprehensive fixture.
 *
 * Background: https://github.com/eigenpal/docx-editor/issues/622
 */

import { test, expect } from '@playwright/test';
import { EditorPage } from '../helpers/editor-page';
import type { Page } from '@playwright/test';

function getControls(page: Page, filter?: { tag?: string; type?: string }) {
  return page.evaluate((f) => window.__DOCX_EDITOR_E2E__?.agentGetContentControls(f) ?? [], filter);
}

test.describe('Content-control addressing (#622)', () => {
  let editor: EditorPage;

  test.beforeEach(async ({ page }) => {
    editor = new EditorPage(page);
    await editor.goto();
    await editor.waitForReady();
    await editor.loadDocxFile('fixtures/block-sdt-comprehensive.docx');
  });

  test('getContentControls discovers controls by tag', async ({ page }) => {
    const all = await getControls(page);
    expect(all.length).toBeGreaterThanOrEqual(11);
    const tags = all.map((c) => c.tag);
    expect(tags).toContain('intro');
    expect(tags).toContain('multi');
    expect(tags).toContain('inner'); // nested control surfaced

    const intro = (await getControls(page, { tag: 'intro' }))[0];
    expect(intro.alias).toBe('Intro');
    expect(intro.text).toContain('CONTROL #1');
  });

  test('setContentControlContent fills a control by tag', async ({ page }) => {
    const ok = await page.evaluate(
      () =>
        window.__DOCX_EDITOR_E2E__?.agentSetContentControlContent(
          { tag: 'intro' },
          'Filled by E2E'
        ) ?? false
    );
    expect(ok).toBe(true);

    const intro = (await getControls(page, { tag: 'intro' }))[0];
    expect(intro.text).toBe('Filled by E2E');
    // The painted page reflects the edit.
    await expect(page.locator('.layout-page-content')).toContainText('Filled by E2E');
  });

  test('setContentControlContent returns false for an unknown tag', async ({ page }) => {
    const ok = await page.evaluate(
      () =>
        window.__DOCX_EDITOR_E2E__?.agentSetContentControlContent({ tag: 'does-not-exist' }, 'x') ??
        false
    );
    expect(ok).toBe(false);
  });

  test('removeContentControl deletes a control', async ({ page }) => {
    const ok = await page.evaluate(
      () => window.__DOCX_EDITOR_E2E__?.agentRemoveContentControl({ tag: 'intro' }) ?? false
    );
    expect(ok).toBe(true);
    const tags = (await getControls(page)).map((c) => c.tag);
    expect(tags).not.toContain('intro');
  });

  test('refuses locked and typed controls through the ref, force overrides', async ({ page }) => {
    // The ref re-throws lock/type refusals (only not-found returns false), so a
    // direct call rejects; wrap to capture the outcome.
    const result = await page.evaluate(() => {
      const hook = window.__DOCX_EDITOR_E2E__!;
      const tryFill = (tag: string) => {
        try {
          return { ok: hook.agentSetContentControlContent({ tag }, 'x') };
        } catch (e) {
          return { threw: (e as Error).name };
        }
      };
      return {
        locked: tryFill('locked'), // sdtContentLocked → throws
        dropdown: tryFill('choice'), // dropDownList → throws
        forcedDropdown: hook.agentSetContentControlContent({ tag: 'choice' }, 'Archived', {
          force: true,
        }),
      };
    });
    expect(result.locked.threw).toBeTruthy();
    expect(result.dropdown.threw).toBeTruthy();
    expect(result.forcedDropdown).toBe(true);
  });

  test('scrollToContentControl resolves a real tag and rejects a missing one', async ({ page }) => {
    const hit = await page.evaluate(
      () => window.__DOCX_EDITOR_E2E__?.agentScrollToContentControl({ tag: 'last' }) ?? false
    );
    expect(hit).toBe(true);
    const miss = await page.evaluate(
      () => window.__DOCX_EDITOR_E2E__?.agentScrollToContentControl({ tag: 'nope' }) ?? false
    );
    expect(miss).toBe(false);
  });
});

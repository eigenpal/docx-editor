/**
 * Pasting over a selection in suggesting mode (issue #761).
 *
 * Replacing a selection by pasting must mark the OLD text as a tracked
 * deletion and the pasted text as a tracked insertion — the same outcome as
 * typing over a selection. Pasting at a collapsed cursor must stay a plain
 * tracked insertion with no spurious deletion.
 *
 * The test drives the real `handlePaste` plugin prop with a ProseMirror slice
 * (copying = serializing the selected content) so it exercises the production
 * path without depending on the OS clipboard.
 *
 * Background: https://github.com/eigenpal/docx-editor/issues/761
 */

import { test, expect } from '@playwright/test';
import { EditorPage } from '../helpers/editor-page';

async function setSuggestionMode(
  page: import('@playwright/test').Page,
  active: boolean,
  author?: string
) {
  const ok = await page.evaluate(
    ({ a, u }) => window.__DOCX_EDITOR_E2E__?.setSuggestionMode(a, u) ?? false,
    { a: active, u: author }
  );
  await page.locator('.ProseMirror').first().focus();
  return ok;
}

test.describe('Paste over selection in suggesting mode (issue #761)', () => {
  let editor: EditorPage;

  test.beforeEach(async ({ page }) => {
    editor = new EditorPage(page);
    await editor.gotoEmpty();
    await editor.waitForReady();
    await editor.focus();
  });

  test('replacing a selection by pasting marks deletion + insertion', async ({ page }) => {
    await editor.typeText('The quick brown fox');
    await setSuggestionMode(page, true, 'Tester');

    const runs = await page.evaluate(() => {
      type V = {
        state: any;
        dispatch: (tr: unknown) => void;
        someProp: (name: string, f: (v: unknown) => unknown) => unknown;
      };
      const view = (
        window as unknown as { __DOCX_EDITOR_E2E__: { getView: () => V | null } }
      ).__DOCX_EDITOR_E2E__.getView();
      if (!view) throw new Error('no view');

      const findRange = (needle: string) => {
        let r: { from: number; to: number } | null = null;
        view.state.doc.descendants((node: any, pos: number) => {
          if (r) return false;
          if (node.isText && node.text) {
            const i = (node.text as string).indexOf(needle);
            if (i >= 0) r = { from: pos + i, to: pos + i + needle.length };
          }
          return true;
        });
        if (!r) throw new Error(`text not found: ${needle}`);
        return r;
      };

      const copyR = findRange('quick');
      const slice = view.state.doc.slice(copyR.from, copyR.to);

      const targetR = findRange('fox');
      const TS = view.state.selection.constructor;
      view.dispatch(
        view.state.tr.setSelection(TS.create(view.state.doc, targetR.from, targetR.to))
      );

      view.someProp('handlePaste', (f: any) => f(view, {}, slice));

      const out: { text: string; marks: string[] }[] = [];
      view.state.doc.descendants((node: any) => {
        if (node.isText && node.text)
          out.push({ text: node.text, marks: node.marks.map((m: any) => m.type.name) });
      });
      return out;
    });

    const deleted = runs.find((r) => r.text.includes('fox'));
    const inserted = runs.find((r) => r.text.includes('quick') && r.marks.includes('insertion'));

    expect(deleted, 'old "fox" run still present').toBeTruthy();
    expect(deleted!.marks, 'old text marked deleted').toContain('deletion');
    expect(inserted, 'pasted "quick" marked inserted').toBeTruthy();
    // Pasted text must never carry a deletion mark.
    expect(inserted!.marks).not.toContain('deletion');
  });

  test('pasting at a collapsed cursor stays a plain insertion', async ({ page }) => {
    await editor.typeText('alpha beta gamma');
    await setSuggestionMode(page, true, 'Tester');

    const result = await page.evaluate(() => {
      type V = {
        state: any;
        dispatch: (tr: unknown) => void;
        someProp: (name: string, f: (v: unknown) => unknown) => unknown;
      };
      const view = (
        window as unknown as { __DOCX_EDITOR_E2E__: { getView: () => V | null } }
      ).__DOCX_EDITOR_E2E__.getView();
      if (!view) throw new Error('no view');

      let betaFrom = -1;
      view.state.doc.descendants((node: any, pos: number) => {
        if (betaFrom >= 0) return false;
        if (node.isText && node.text) {
          const i = (node.text as string).indexOf('beta');
          if (i >= 0) betaFrom = pos + i;
        }
        return true;
      });
      const slice = view.state.doc.slice(betaFrom, betaFrom + 4);
      const end = view.state.doc.content.size - 1;
      const TS = view.state.selection.constructor;
      view.dispatch(view.state.tr.setSelection(TS.create(view.state.doc, end, end)));
      const handled = view.someProp('handlePaste', (f: any) => f(view, {}, slice));

      const out: { text: string; marks: string[] }[] = [];
      view.state.doc.descendants((node: any) => {
        if (node.isText && node.text)
          out.push({ text: node.text, marks: node.marks.map((m: any) => m.type.name) });
      });
      return { handled: !!handled, runs: out };
    });

    // handlePaste declines collapsed-cursor pastes (returns falsy) so the
    // default paste + append-transaction catch-all marks the insertion.
    expect(result.handled).toBeFalsy();
    // No run is a deletion — pasting at a cursor deletes nothing.
    expect(result.runs.every((r) => !r.marks.includes('deletion'))).toBe(true);
  });
});

/**
 * Vue parity for issue #761 — pasting over a selection in suggesting mode marks
 * the replaced text as a tracked deletion and the pasted text as an insertion.
 * The behavior lives in the shared suggestion-mode plugin's `handlePaste`; this
 * proves it fires in the Vue-mounted editor too. Drives the real prop with a PM
 * slice (no OS clipboard).
 */

import { test, expect } from '@playwright/test';

async function setSuggestionMode(page: import('@playwright/test').Page, active: boolean) {
  const ok = await page.evaluate(
    (a) => window.__DOCX_EDITOR_E2E__?.setSuggestionMode(a, 'Tester') ?? false,
    active
  );
  await page.locator('.ProseMirror').first().focus();
  return ok;
}

test('Vue: pasting over a selection marks deletion + insertion in suggesting mode (#761)', async ({
  page,
}) => {
  await page.goto('http://localhost:5174/?e2e=1');
  await page.locator('.docx-editor-vue').waitFor();
  await page.waitForSelector('[data-page-number]');

  // Seed a known sentence as the first paragraph so the run lookup is stable.
  await page.evaluate(() => {
    const view = (
      window as unknown as { __DOCX_EDITOR_E2E__: { getView: () => any } }
    ).__DOCX_EDITOR_E2E__.getView();
    const s = view.state.schema;
    const para = s.nodes.paragraph.create(null, s.text('The quick brown fox'));
    view.dispatch(view.state.tr.insert(0, para));
  });
  await setSuggestionMode(page, true);

  const runs = await page.evaluate(() => {
    const view = (
      window as unknown as {
        __DOCX_EDITOR_E2E__: { getView: () => any };
      }
    ).__DOCX_EDITOR_E2E__.getView();
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
      if (!r) throw new Error(`not found: ${needle}`);
      return r;
    };
    const copyR = findRange('quick');
    const slice = view.state.doc.slice(copyR.from, copyR.to);
    const targetR = findRange('fox');
    const TS = view.state.selection.constructor;
    view.dispatch(view.state.tr.setSelection(TS.create(view.state.doc, targetR.from, targetR.to)));
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
  expect(inserted!.marks).not.toContain('deletion');
});

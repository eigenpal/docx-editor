import { test, expect } from '@playwright/test';
import { EditorPage } from '../helpers/editor-page';

/**
 * Regression for #748 — on a line with mixed font sizes the painted caret was
 * always as tall as the largest run (the line box), even with the insertion
 * point in small text. The caret height now tracks the run at the cursor (the
 * collapsed range's per-run rect), like Word. Core fix (resolveDomPosition),
 * so it covers React and Vue.
 */
test('caret height matches the font at the cursor on a mixed-size line (#748)', async ({
  page,
}) => {
  const editor = new EditorPage(page);
  await editor.goto();
  await page.waitForSelector('.layout-page-content .layout-run-text');

  const result = await page.evaluate(async () => {
    type V = {
      state: any;
      dispatch: (tr: unknown) => void;
    };
    const view = (
      window as unknown as { __DOCX_EDITOR_E2E__: { getView: () => V | null } }
    ).__DOCX_EDITOR_E2E__.getView();
    if (!view) return null;

    // Make the first 3 chars of a body paragraph 72pt → a mixed-size line.
    let para = -1;
    view.state.doc.descendants((node: any, p: number) => {
      if (para >= 0) return false;
      if (node.isTextblock && (node.textContent as string).trim().length >= 30) para = p;
      return true;
    });
    if (para < 0) return null;
    const from = para + 1;
    view.dispatch(
      view.state.tr.addMark(from, from + 3, view.state.schema.marks.fontSize.create({ size: 144 }))
    );
    await new Promise((r) => setTimeout(r, 300));

    const TS = view.state.selection.constructor;
    const caretH = () => {
      const c = document.querySelector('[data-testid="caret"]');
      return c ? Math.round(c.getBoundingClientRect().height) : null;
    };

    // Caret inside the 72pt word.
    view.dispatch(view.state.tr.setSelection(TS.create(view.state.doc, para + 2)));
    await new Promise((r) => setTimeout(r, 200));
    const hBig = caretH();

    // Caret in the normal-size text after it.
    view.dispatch(view.state.tr.setSelection(TS.create(view.state.doc, para + 8)));
    await new Promise((r) => setTimeout(r, 200));
    const hSmall = caretH();

    return { hBig, hSmall };
  });

  expect(result, 'mixed-size line was built and carets measured').toBeTruthy();
  expect(result!.hBig).toBeGreaterThan(80); // ~72pt → ~116px
  expect(result!.hSmall).not.toBeNull();
  // Caret in small text tracks its own font, far shorter than the 72pt word.
  // The bug made them equal (both the line box).
  expect(result!.hSmall!).toBeLessThan(result!.hBig! * 0.5);
});

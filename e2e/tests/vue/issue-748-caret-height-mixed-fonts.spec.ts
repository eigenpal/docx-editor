import { test, expect } from '@playwright/test';

/**
 * Vue counterpart of the #748 regression — the caret-height fix lives in shared
 * core (`resolveDomPosition`), so the Vue painted caret must also track the run
 * at the cursor (not the line box) on a line with mixed font sizes.
 */
test('Vue: caret height matches the font at the cursor on a mixed-size line (#748)', async ({
  page,
}) => {
  await page.goto('http://localhost:5174/?e2e=1');
  await page.locator('.docx-editor-vue').waitFor();
  await page.waitForSelector('.layout-page-content .layout-run-text');

  const result = await page.evaluate(async () => {
    const view = (
      window as unknown as { __DOCX_EDITOR_E2E__: { getView: () => any } }
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
      const c = document.querySelector('.vue-caret');
      return c ? Math.round(c.getBoundingClientRect().height) : null;
    };

    view.dispatch(view.state.tr.setSelection(TS.create(view.state.doc, para + 2)));
    await new Promise((r) => setTimeout(r, 200));
    const hBig = caretH();

    view.dispatch(view.state.tr.setSelection(TS.create(view.state.doc, para + 8)));
    await new Promise((r) => setTimeout(r, 200));
    const hSmall = caretH();

    return { hBig, hSmall };
  });

  expect(result, 'mixed-size line was built and carets measured').toBeTruthy();
  expect(result!.hBig).toBeGreaterThan(80); // ~72pt → ~116px
  expect(result!.hSmall).not.toBeNull();
  expect(result!.hSmall!).toBeLessThan(result!.hBig! * 0.5);
});

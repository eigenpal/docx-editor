/**
 * Caret size at non-100% zoom (issue #928).
 *
 * The caret is painted inside the page container, which carries
 * `transform: scale(zoom)`. Its height must be set in layout px so the
 * transform scales it to match the text. The text-run caret height came from
 * `getBoundingClientRect` (already scaled), so it was effectively scaled twice
 * and rendered ~`height * zoom` too tall. After the fix the on-screen caret
 * height scales LINEARLY with zoom (core `getCaretPositionFromDom` normalizes
 * the one scaled measurement by zoom) — covers React and Vue via core.
 *
 * Background: https://github.com/eigenpal/docx-editor/issues/928
 */

import { test, expect } from '@playwright/test';
import { EditorPage } from '../helpers/editor-page';

// Measure, at the CURRENT zoom, the on-screen caret height, the on-screen
// height of the text line the caret sits on, and the container's CSS scale.
// The caret tracks the run's font box, which is at most the line box; the bug
// double-scaled it so the painted caret became ~`scale`× the line height.
function measureAtCaret(): { caretH: number; lineH: number; scale: number } {
  const caretEl = document.querySelector('[data-testid="caret"]') as HTMLElement | null;
  const caretRect = caretEl?.getBoundingClientRect();
  const caretH = caretRect ? caretRect.height : -1;

  let lineH = -1;
  if (caretRect) {
    const midY = caretRect.top + caretRect.height / 2;
    const midX = caretRect.left;
    for (const el of Array.from(document.querySelectorAll('.layout-page-content .layout-line'))) {
      const r = (el as HTMLElement).getBoundingClientRect();
      if (midY >= r.top && midY <= r.bottom && midX >= r.left - 4) {
        lineH = r.height;
        break;
      }
    }
  }

  const scaled = document.querySelector('.paged-editor__pages')
    ?.parentElement as HTMLElement | null;
  let scale = 1;
  if (scaled) {
    const m = new DOMMatrixReadOnly(getComputedStyle(scaled).transform);
    scale = m.a || 1;
  }
  return { caretH, lineH, scale };
}

test('caret height scales linearly with zoom (#928)', async ({ page }) => {
  const editor = new EditorPage(page);
  await editor.goto();
  await editor.waitForReady();

  // Put the caret in the middle of the first text run so the height comes from
  // the text-run path (the scaled-measurement path that the bug affected).
  const placeCaret = () =>
    page.evaluate(() => {
      type V = { state: any; dispatch: (tr: unknown) => void; focus: () => void };
      const view = (
        window as unknown as { __DOCX_EDITOR_E2E__: { getView: () => V | null } }
      ).__DOCX_EDITOR_E2E__.getView();
      if (!view) throw new Error('no view');
      let pos = -1;
      view.state.doc.descendants((node: any, p: number) => {
        if (pos >= 0) return false;
        if (node.isText && (node.text?.length ?? 0) > 4) {
          pos = p + 2; // a couple chars into the run
          return false;
        }
        return true;
      });
      if (pos < 0) throw new Error('no text run');
      const TS = view.state.selection.constructor;
      view.dispatch(view.state.tr.setSelection(TS.create(view.state.doc, pos)));
      view.focus();
    });

  await placeCaret();

  // Zoom in three steps (100% -> 125% -> 150% -> 200%) via the toolbar stepper.
  const zoomIn = page.locator('button[aria-label="Zoom in"]');
  for (let i = 0; i < 3; i++) {
    await zoomIn.click();
    await page.waitForTimeout(150);
  }

  // Clicking the toolbar blurred the editor (hiding the caret), so re-focus and
  // re-assert the selection before measuring.
  await placeCaret();
  await page.waitForTimeout(250);

  const m = await page.evaluate(measureAtCaret);
  expect(m.caretH).toBeGreaterThan(0);
  expect(m.lineH).toBeGreaterThan(0);
  // The container is actually zoomed in.
  expect(m.scale).toBeGreaterThan(1.5);

  // The caret tracks the run's font box, so its on-screen height must not exceed
  // the on-screen line height (small slack for sub-pixel rounding). Before the
  // fix the caret was scaled twice and rendered ~`scale`× the line height, far
  // past this bound.
  expect(m.caretH).toBeLessThanOrEqual(m.lineH * 1.2);
  // Sanity floor: the caret should still be a visible fraction of the line.
  expect(m.caretH).toBeGreaterThanOrEqual(m.lineH * 0.4);
});

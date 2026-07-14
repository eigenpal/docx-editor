/**
 * Body-PM caret/selection helpers for dual-render e2e.
 * Painter / window.getSelection() does not update toolbar state — dispatch
 * TextSelection on the hidden body EditorView instead.
 */

import type { Page } from '@playwright/test';

export async function placeCursorInBodyPmText(
  page: Page,
  searchText: string,
  offsetWithin = 0
): Promise<boolean> {
  const ok = await page.evaluate(
    ({ text, offsetWithin: off }) => {
      const view = window.__DOCX_EDITOR_E2E__?.getView?.();
      if (!view) return false;
      let found = -1;
      view.state.doc.descendants((node: { isText?: boolean; text?: string }, pos: number) => {
        if (found >= 0) return false;
        if (!node.isText || !node.text) return true;
        const idx = node.text.indexOf(text);
        if (idx < 0) return true;
        found = pos + idx + off;
        return false;
      });
      if (found < 0) return false;
      const TS = view.state.selection.constructor as {
        create: (doc: unknown, pos: number) => unknown;
      };
      view.dispatch(view.state.tr.setSelection(TS.create(view.state.doc, found)));
      view.focus();
      return true;
    },
    { text: searchText, offsetWithin }
  );
  await page.waitForTimeout(100);
  return ok;
}

export async function selectBodyPmTextRange(
  page: Page,
  searchText: string,
  startOffset: number,
  endOffset: number
): Promise<boolean> {
  const ok = await page.evaluate(
    ({ text, startOffset: start, endOffset: end }) => {
      const view = window.__DOCX_EDITOR_E2E__?.getView?.();
      if (!view) return false;
      let found = -1;
      view.state.doc.descendants((node: { isText?: boolean; text?: string }, pos: number) => {
        if (found >= 0) return false;
        if (!node.isText || !node.text) return true;
        const idx = node.text.indexOf(text);
        if (idx < 0) return true;
        found = pos + idx;
        return false;
      });
      if (found < 0) return false;
      const TS = view.state.selection.constructor as {
        create: (doc: unknown, from: number, to: number) => unknown;
      };
      view.dispatch(
        view.state.tr.setSelection(TS.create(view.state.doc, found + start, found + end))
      );
      view.focus();
      return true;
    },
    { text: searchText, startOffset, endOffset }
  );
  await page.waitForTimeout(100);
  return ok;
}

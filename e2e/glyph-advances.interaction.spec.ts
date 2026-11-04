// Highlights, the selection and the caret take their geometry from layout. The painted glyphs
// must sit at the same advances, also where the browser hints the advances of a web font.

import { expect, test } from '@playwright/test';
import { PAINTED_PAGE } from './painted-page.ts';

const URL = 'http://localhost:5273/?e2e=1&fixture=embedded-font.docx';

test('a highlight covers the painted text of an embedded face', async ({ page }) => {
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__DOCX_EDITOR_E2E__?.fontMeasurer() === 'shaped');
  await page.waitForSelector(`${PAINTED_PAGE} .docx-paragraph-fragment`);
  const edges = await page.evaluate(async () => {
    const editor = window.__DOCX_EDITOR_E2E__!.getEditor()!;
    const [match] = editor.findMatches('lazy dog.', { matchCase: true });
    if (!match) throw new Error('no match');
    editor.setHighlights('advances', [match]);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const mark = document
      .querySelector('[data-highlight-set="advances"] .docx-text-highlight')!
      .getBoundingClientRect();
    let left = Infinity;
    let right = -Infinity;
    const runs = document.querySelectorAll<HTMLElement>(
      `.layout-run-text[data-paragraph-id="${match.blockId}"]`
    );
    for (const run of runs) {
      const start = Number(run.dataset.start);
      const from = Math.max(start, match.start) - start;
      const to = Math.min(Number(run.dataset.end), match.start + match.length) - start;
      const text = document.createTreeWalker(run, NodeFilter.SHOW_TEXT).nextNode();
      if (!text || from >= to) continue;
      const range = document.createRange();
      range.setStart(text, from);
      range.setEnd(text, to);
      const box = range.getBoundingClientRect();
      left = Math.min(left, box.left);
      right = Math.max(right, box.right);
    }
    return { markLeft: mark.left, markRight: mark.right, left, right };
  });
  expect(Math.abs(edges.markLeft - edges.left)).toBeLessThan(0.5);
  expect(Math.abs(edges.markRight - edges.right)).toBeLessThan(0.5);
});

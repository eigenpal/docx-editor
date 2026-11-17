// A span that repeats a model range: the browser's copy in the same line, or a repeat elsewhere.
//
// Chromium, composing over a selection set in another face than the text on both sides of it,
// writes the composed text into a copy of a neighbouring span, range attributes included, beside
// the original. The readback reads each model range once, so it dropped that text.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { expect, test } from 'bun:test';
import { paintedTextIn } from '../surface-composition-readback.ts';

type Span = readonly [text: string, start: number, end: number];

/** One fragment per entry, each one line of spans, as the painter stamps them. */
function painted(...fragments: readonly (readonly Span[])[]): HTMLElement {
  const root = document.createElement('div');
  fragments.forEach((spans, index) => {
    const fragment = document.createElement('div');
    fragment.className = 'docx-paragraph-fragment';
    fragment.dataset.paragraphId = 'p1';
    fragment.dataset.fragmentIndex = String(index);
    const line = document.createElement('div');
    line.className = 'docx-line';
    line.dataset.paragraphId = 'p1';
    for (const [text, start, end] of spans) {
      const span = document.createElement('span');
      span.dataset.paragraphId = 'p1';
      span.dataset.start = String(start);
      span.dataset.end = String(end);
      span.textContent = text;
      line.append(span);
    }
    fragment.append(line);
    root.append(fragment);
  });
  return root;
}

const MODEL = '시험번호GMEB-26202의';
/** The selected word's ranges, which Chromium removed with their spans. */
const ERASED = new Set(['4:9', '9:14']);

test("text in the browser's copy of the span before reads after that span", () => {
  const root = painted([
    ['시험번호', 0, 4],
    ['한', 0, 4],
    ['의', 14, 15],
  ]);
  expect(paintedTextIn(root, 'p1', MODEL, null, ERASED)).toBe('시험번호한의');
});

test("text in the browser's copy of the span after reads before that span", () => {
  const root = painted([
    ['시험번호', 0, 4],
    ['한', 14, 15],
    ['의', 14, 15],
  ]);
  expect(paintedTextIn(root, 'p1', MODEL, null, ERASED)).toBe('시험번호한의');
});

test('a range repeated on another sheet contributes ONCE, though one copy was written', () => {
  // Only a copy in the same line is the browser's. A repeat on another sheet is the same
  // characters, whatever it shows: reading it as written text put the paragraph in twice.
  const root = painted([['Helxlo', 0, 5]], [['Hello', 0, 5]]);
  expect(paintedTextIn(root, 'p1', 'Hello', null)).toBe('Helxlo');
});

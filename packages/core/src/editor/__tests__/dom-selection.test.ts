// Reading a native browser selection back as model positions.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import {
  applySelectionToDom,
  positionFromDomPoint,
  selectionsEqual,
  semanticSelectionFromDom,
} from '../dom-selection.ts';

/** A painted line: spans stamped with the source range they were laid out from. */
function paintedLine(
  spans: readonly { text: string; paragraphId: string; start: number }[]
): HTMLElement {
  const root = document.createElement('div');
  const line = document.createElement('div');
  line.className = 'docx-line';
  for (const span of spans) {
    const element = document.createElement('span');
    element.dataset.paragraphId = span.paragraphId;
    element.dataset.start = String(span.start);
    element.dataset.end = String(span.start + span.text.length);
    element.textContent = span.text;
    line.append(element);
  }
  root.append(line);
  return root;
}

const LINE = [
  { text: 'hello ', paragraphId: 'p1', start: 0 },
  { text: 'world', paragraphId: 'p1', start: 6 },
];

describe('a DOM endpoint becomes a model position', () => {
  test('an offset inside a span adds to the span start', () => {
    const root = paintedLine(LINE);
    const span = root.querySelectorAll('span')[1]!;
    expect(positionFromDomPoint(span.firstChild!, 3, root)).toEqual({
      paragraphId: 'p1',
      offset: 9,
    });
  });

  test('the start of the first span is offset zero', () => {
    const root = paintedLine(LINE);
    const span = root.querySelector('span')!;
    expect(positionFromDomPoint(span.firstChild!, 0, root)).toEqual({
      paragraphId: 'p1',
      offset: 0,
    });
  });

  test('an endpoint on the span element itself still resolves', () => {
    const root = paintedLine(LINE);
    const span = root.querySelectorAll('span')[1]!;
    expect(positionFromDomPoint(span, 0, root)).toEqual({ paragraphId: 'p1', offset: 6 });
  });

  test('an endpoint on the LINE resolves to the span that boundary points at', () => {
    // Clicking in the empty space right of a short line lands on the line, not on text.
    const root = paintedLine(LINE);
    const line = root.querySelector('.docx-line')!;
    expect(positionFromDomPoint(line, 1, root)).toEqual({ paragraphId: 'p1', offset: 6 });
  });

  test('an offset past the span text is clamped rather than running off the end', () => {
    const root = paintedLine(LINE);
    const span = root.querySelectorAll('span')[1]!;
    expect(positionFromDomPoint(span.firstChild!, 99, root)).toEqual({
      paragraphId: 'p1',
      offset: 11,
    });
  });

  test('a node outside the painted root is not a position', () => {
    const root = paintedLine(LINE);
    const elsewhere = document.createElement('div');
    elsewhere.textContent = 'not the document';
    expect(positionFromDomPoint(elsewhere.firstChild!, 0, root)).toBeNull();
  });

  test('a span with a forged data-start is refused, not trusted', () => {
    // The attribute round-trips through the DOM, so what comes back is parsed and
    // range-checked instead of assumed to be the number that was written.
    const root = paintedLine(LINE);
    const span = root.querySelector('span')!;
    span.dataset.start = '__proto__';
    expect(positionFromDomPoint(span.firstChild!, 1, root)).toBeNull();
  });
});

describe('a native selection becomes a semantic selection', () => {
  const select = (root: HTMLElement, from: [number, number], to: [number, number]): Selection => {
    const spans = root.querySelectorAll('span');
    const range = document.createRange();
    range.setStart(spans[from[0]]!.firstChild!, from[1]);
    range.setEnd(spans[to[0]]!.firstChild!, to[1]);
    const selection = document.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    return selection;
  };

  test('a drag across two spans keeps both endpoints', () => {
    const root = paintedLine(LINE);
    document.body.append(root);
    const result = semanticSelectionFromDom(root, select(root, [0, 2], [1, 3]));
    expect(result).toEqual({
      anchor: { paragraphId: 'p1', offset: 2 },
      head: { paragraphId: 'p1', offset: 9 },
    });
    root.remove();
  });

  test('no selection at all is null, not an empty range at the top of the document', () => {
    const root = paintedLine(LINE);
    expect(semanticSelectionFromDom(root, null)).toBeNull();
  });

  test('a selection outside the painted content is null', () => {
    // The caret sitting in the offscreen input host must not read as "nothing selected".
    const root = paintedLine(LINE);
    const elsewhere = document.createElement('div');
    elsewhere.textContent = 'input host';
    document.body.append(root, elsewhere);
    const range = document.createRange();
    range.setStart(elsewhere.firstChild!, 0);
    range.setEnd(elsewhere.firstChild!, 3);
    const selection = document.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    expect(semanticSelectionFromDom(root, selection)).toBeNull();
    root.remove();
    elsewhere.remove();
  });
});

/** An empty paragraph as the painter emits it: fragment > line (with lineId) > <br>. */
function paintedEmptyParagraph(paragraphId: string): HTMLElement {
  const root = document.createElement('div');
  const fragment = document.createElement('div');
  fragment.className = 'docx-paragraph-fragment';
  fragment.dataset.paragraphId = paragraphId;
  fragment.dataset.fragmentIndex = '0';
  const line = document.createElement('div');
  line.className = 'docx-line';
  line.dataset.lineId = 'line-1';
  line.dataset.paragraphId = paragraphId;
  line.append(document.createElement('br'));
  fragment.append(line);
  root.append(fragment);
  return root;
}

describe('the empty-paragraph caret', () => {
  const caret = { paragraphId: 'p9', offset: 0 };

  test('a model caret in an empty paragraph targets the painted LINE, not the fragment', () => {
    // The fragment carries the same identity, but its in-flow content box is empty
    // (children are absolutely positioned), so a browser will not draw a caret there.
    const root = paintedEmptyParagraph('p9');
    document.body.append(root);
    const applied = applySelectionToDom(root, { anchor: caret, head: caret }, getSelection());
    expect(applied).toBe(true);
    const anchorNode = getSelection()!.anchorNode as HTMLElement;
    expect(anchorNode.classList.contains('docx-line')).toBe(true);
    root.remove();
  });

  test('an endpoint on the caret-anchor <br> reads back as the paragraph start', () => {
    const root = paintedEmptyParagraph('p9');
    expect(positionFromDomPoint(root.querySelector('br')!, 0, root)).toEqual(caret);
  });

  test('an endpoint on the empty line reads back as the paragraph start', () => {
    const root = paintedEmptyParagraph('p9');
    expect(positionFromDomPoint(root.querySelector('.docx-line')!, 0, root)).toEqual(caret);
  });
});

describe('selection equality', () => {
  const at = (offset: number) => ({ paragraphId: 'p1', offset });

  test('identical ranges are equal', () => {
    expect(selectionsEqual({ anchor: at(1), head: at(4) }, { anchor: at(1), head: at(4) })).toBe(
      true
    );
  });

  test('a reversed range is NOT equal, because which end moves matters', () => {
    // Shift-arrow extends from the anchor, so a selection dragged right-to-left is a
    // different thing from the same characters dragged left-to-right.
    expect(selectionsEqual({ anchor: at(1), head: at(4) }, { anchor: at(4), head: at(1) })).toBe(
      false
    );
  });

  test('different paragraphs are not equal', () => {
    expect(
      selectionsEqual(
        { anchor: at(1), head: at(4) },
        { anchor: { paragraphId: 'p2', offset: 1 }, head: at(4) }
      )
    ).toBe(false);
  });
});

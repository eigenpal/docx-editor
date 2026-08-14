// Reading a native browser selection back as model positions.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '../../layout/semantic-layout.ts';
import { paintSemanticLayout } from '../../output/semantic-paint.ts';
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

/**
 * A field's result: many painted glyphs over ONE model offset.
 *
 * `[before][field: 1 unit, 24 glyphs][after]`, which is how a computed `REF`
 * cross-reference is laid out. FORMTEXT results are literal and one-to-one.
 */
function paintedFieldLine(): HTMLElement {
  const root = document.createElement('div');
  const line = document.createElement('div');
  line.className = 'docx-line';
  const add = (text: string, start: number, end: number): void => {
    const element = document.createElement('span');
    element.dataset.paragraphId = 'p1';
    element.dataset.start = String(start);
    element.dataset.end = String(end);
    element.textContent = text;
    line.append(element);
  };
  add('a potential ', 0, 12);
  add('Scope of the discussions', 12, 13);
  add(' (the ', 13, 19);
  root.append(line);
  return root;
}

describe('a span whose painted text is wider than its model range', () => {
  // A field paints its whole result but occupies one offset. Deriving an endpoint from the
  // painted text handed back an offset the paragraph does not have, so the op built from it
  // was refused — a caret placed just after such a field could not type at all.
  test('an offset inside the field clamps to its own range', () => {
    const root = paintedFieldLine();
    const field = root.querySelectorAll('span')[1]!;
    // Character 20 of 24 painted — but the field is one unit, so the furthest real position
    // inside it is its end.
    expect(positionFromDomPoint(field.firstChild!, 20, root)).toEqual({
      paragraphId: 'p1',
      offset: 13,
    });
  });

  test('the end of the field is the start of what follows it', () => {
    const root = paintedFieldLine();
    const field = root.querySelectorAll('span')[1]!;
    const after = root.querySelectorAll('span')[2]!;
    expect(positionFromDomPoint(field.firstChild!, 24, root)).toEqual({
      paragraphId: 'p1',
      offset: 13,
    });
    expect(positionFromDomPoint(after.firstChild!, 0, root)).toEqual({
      paragraphId: 'p1',
      offset: 13,
    });
  });

  test('the field as an element endpoint reports its range, not its glyph count', () => {
    const root = paintedFieldLine();
    const field = root.querySelectorAll('span')[1]!;
    expect(positionFromDomPoint(field, 1, root)).toEqual({ paragraphId: 'p1', offset: 13 });
    expect(positionFromDomPoint(field, 0, root)).toEqual({ paragraphId: 'p1', offset: 12 });
  });

  test('a caret just after the field round-trips back into the DOM', () => {
    // The reverse direction has the mirrored trap: the DOM offset is in PAINTED characters,
    // so a model position must not be handed to a text node as if the two agreed.
    const root = paintedFieldLine();
    document.body.append(root);
    const caret = { paragraphId: 'p1', offset: 13 };
    expect(applySelectionToDom(root, { anchor: caret, head: caret }, getSelection())).toBe(true);
    expect(semanticSelectionFromDom(root, getSelection())).toEqual({ anchor: caret, head: caret });
    root.remove();
  });

  test('ordinary runs are unaffected', () => {
    const root = paintedLine(LINE);
    const span = root.querySelectorAll('span')[1]!;
    expect(positionFromDomPoint(span.firstChild!, 3, root)).toEqual({
      paragraphId: 'p1',
      offset: 9,
    });
  });
});

describe('painted FORMTEXT selection mapping', () => {
  const paintField = (instruction: string, result: string, formData = ''): HTMLElement => {
    const parsed = readOoxmlPart(
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
        `<w:body><w:p>` +
        `<w:r><w:fldChar w:fldCharType="begin">${formData}</w:fldChar></w:r>` +
        `<w:r><w:instrText xml:space="preserve"> ${instruction} </w:instrText></w:r>` +
        `<w:r><w:fldChar w:fldCharType="separate"/></w:r>` +
        `<w:r><w:t>${result}</w:t></w:r>` +
        `<w:r><w:fldChar w:fldCharType="end"/></w:r>` +
        `</w:p></w:body></w:document>`,
      { name: '/word/document.xml', contentType: 'application/xml' }
    );
    if (!parsed.ok) throw new Error(parsed.reason);
    const layout = layoutSemanticDocument(parsed.part, 1, {
      measurer: createFixedMeasurer(6, 14),
    });
    const root = document.createElement('div');
    paintSemanticLayout(root, layout, { scale: 1, ariaHidden: false });
    return root;
  };

  test('a caret inside a literal form result maps character-for-character', () => {
    const root = paintField(
      'FORMTEXT',
      'Street',
      '<w:ffData><w:name w:val="Text1"/><w:textInput/></w:ffData>'
    );
    const field = root.querySelector<HTMLElement>('[data-field-atom="form"]')!;
    expect(field).toBeDefined();
    expect(field.hasAttribute('data-docx-field')).toBe(false);
    expect(field.getAttribute('contenteditable')).not.toBe('false');
    expect(positionFromDomPoint(field.firstChild!, 3, root)).toEqual({
      paragraphId: field.dataset.paragraphId,
      offset: Number(field.dataset.start) + 3,
    });
  });

  test('a computed field remains projected and unmappable inside its cache', () => {
    const root = paintField('REF Company', 'Street');
    const field = root.querySelector<HTMLElement>('[data-docx-field]')!;
    expect(field).toBeDefined();
    expect(field.getAttribute('contenteditable')).toBe('false');
    expect(positionFromDomPoint(field.firstChild!, 3, root)).toBeNull();
  });
});

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

  test('a caret inside a list marker is refused', () => {
    const root = paintedLine(LINE);
    const marker = document.createElement('span');
    marker.dataset.docxMarker = '';
    marker.textContent = '•';
    root.append(marker);
    document.body.append(root);
    const range = document.createRange();
    range.setStart(marker.firstChild!, 0);
    range.collapse(true);
    const selection = document.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    expect(semanticSelectionFromDom(root, selection)).toBeNull();
    root.remove();
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

test('a model position with CSS delimiters in its id is mapped without parsing them', () => {
  const paragraphId = 'p"#]';
  const root = paintedLine([{ text: 'safe', paragraphId, start: 0 }]);
  document.body.append(root);
  const caret = { paragraphId, offset: 2 };
  expect(applySelectionToDom(root, { anchor: caret, head: caret }, getSelection())).toBe(true);
  expect(getSelection()!.anchorOffset).toBe(2);
  root.remove();
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

// "Shade the field the caret is in" — resolved in the DOM, never in layout.
//
// Word's default field-shading mode depends on where the insertion point is. Answering that in
// layout would fold the caret into the per-block cache key and remeasure on every arrow press;
// answering it in paint would rebuild spans just as often. Both are enormous costs for a
// background colour, so layout marks what IS a field and this moves one class.

import { GlobalRegistrator } from '@happy-dom/global-registrator';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { beforeEach, describe, expect, test } from 'bun:test';
import { syncActiveFieldShading } from '../surface-field-shading.ts';

const ACTIVE = 'docx-field-atom--active';

let layer: HTMLElement;

/** Two fields in one paragraph, plus a field in another, plus untracked text. */
function build(): void {
  layer = document.createElement('div');
  layer.innerHTML = '';
  const add = (
    paragraphId: string,
    start: number,
    end: number,
    field: string | null
  ): HTMLElement => {
    const span = document.createElement('span');
    span.dataset.paragraphId = paragraphId;
    span.dataset.start = String(start);
    span.dataset.end = String(end);
    if (field) span.dataset.fieldAtom = field;
    layer.append(span);
    return span;
  };
  add('p1', 0, 5, null); // plain text
  add('p1', 5, 6, 'field'); // the field at offset 5..6
  add('p1', 6, 11, null); // plain text
  add('p2', 0, 1, 'form'); // a field in a different paragraph
}

function activeSpans(): HTMLElement[] {
  return [...layer.querySelectorAll<HTMLElement>(`.${ACTIVE}`)];
}

describe('the caret marks the field it sits in', () => {
  beforeEach(build);

  test('a caret inside the field marks it', () => {
    syncActiveFieldShading(layer, { paragraphId: 'p1', offset: 5 });
    expect(activeSpans()).toHaveLength(1);
    expect(activeSpans()[0]?.dataset.start).toBe('5');
  });

  test('a caret at the trailing edge still counts as inside', () => {
    // A field is ONE model unit, so both its edges are positions Word treats as within it.
    // Excluding the trailing edge made the shading flicker off as the caret arrived.
    syncActiveFieldShading(layer, { paragraphId: 'p1', offset: 6 });
    expect(activeSpans()).toHaveLength(1);
  });

  test('a caret in ordinary text marks nothing', () => {
    syncActiveFieldShading(layer, { paragraphId: 'p1', offset: 2 });
    expect(activeSpans()).toHaveLength(0);
  });

  test('a caret in another paragraph does not reach across', () => {
    syncActiveFieldShading(layer, { paragraphId: 'p2', offset: 0 });
    expect(activeSpans()).toHaveLength(1);
    expect(activeSpans()[0]?.dataset.fieldAtom).toBe('form');
  });

  test('moving the caret away clears the previous mark', () => {
    syncActiveFieldShading(layer, { paragraphId: 'p1', offset: 5 });
    expect(activeSpans()).toHaveLength(1);
    syncActiveFieldShading(layer, { paragraphId: 'p1', offset: 0 });
    expect(activeSpans()).toHaveLength(0);
  });

  test('no collapsed caret clears everything', () => {
    // A range selection paints its own highlight; a second background under one end of it
    // reads as a second selection.
    syncActiveFieldShading(layer, { paragraphId: 'p1', offset: 5 });
    syncActiveFieldShading(layer, null);
    expect(activeSpans()).toHaveLength(0);
  });

  test('a paragraph id carrying selector syntax cannot escape the query', () => {
    // Engine-minted, but it is still interpolated into a selector — the ids are part names
    // plus a path, and a part name comes from the file.
    const hostile = document.createElement('span');
    hostile.dataset.paragraphId = 'p"] , [data-field-atom';
    hostile.dataset.start = '0';
    hostile.dataset.end = '1';
    hostile.dataset.fieldAtom = 'field';
    layer.append(hostile);
    syncActiveFieldShading(layer, { paragraphId: 'p"] , [data-field-atom', offset: 0 });
    expect(activeSpans()).toHaveLength(1);
    expect(activeSpans()[0]).toBe(hostile);
  });
});

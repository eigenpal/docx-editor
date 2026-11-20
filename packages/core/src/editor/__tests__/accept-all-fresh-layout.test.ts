// While the review filter keeps its key after the last left-out record goes, the live layout
// stays the layout of the saved document opened again: the same geometry and the same markup.

import { expect, setDefaultTimeout, test } from 'bun:test';
import {
  CHANGES,
  INERT,
  SPLIT_RECORD,
  SPLIT_RECORD_TEXT,
  TABLE_WITH_RECORD,
  compareFresh,
  mount,
} from './accept-all-layout-reuse-fixture.ts';

// Each comparison opens the saved document again and lays it out from the top.
setDefaultTimeout(30_000);

test('accept all, then undo, then redo', () => {
  using view = mount(CHANGES);
  // Five insertions and one centered paragraph paint markup. The inert record paints none.
  const before = compareFresh(view);
  expect(before.bars).toBe(CHANGES.size - 1);
  view.acceptAll();
  expect(compareFresh(view)).toMatchObject({ bars: 0, marked: [] });
  view.run({ type: 'undo' });
  expect(compareFresh(view)).toEqual(before);
  view.run({ type: 'redo' });
  expect(compareFresh(view)).toMatchObject({ bars: 0, marked: [] });
});

test('reject all', () => {
  using view = mount(CHANGES);
  view.run({ type: 'resolveAllReviewChanges', action: 'reject' });
  expect(view.listed()).toBe(0);
  expect(compareFresh(view)).toMatchObject({ bars: 0, marked: [] });
});

test('accept all, then tracked format changes with a card and with none', () => {
  using view = mount(CHANGES);
  view.acceptAll();
  view.surface.setEditingMode('suggest');
  view.select(10);
  view.run({ type: 'setAlignment', align: 'center' });
  expect(view.listed()).toBe(1);
  expect(compareFresh(view).bars).toBe(1);
  // Left-aligned already: the record has no card and paints no markup.
  view.select(14);
  view.run({ type: 'setAlignment', align: 'left' });
  expect(view.listed()).toBe(1);
  expect(compareFresh(view).bars).toBe(1);
  // That record gets a card when its paragraph is centered.
  view.run({ type: 'setAlignment', align: 'center' });
  expect(view.listed()).toBe(2);
  expect(compareFresh(view).bars).toBe(2);
  // The first record loses its card when its paragraph goes back to the left.
  view.select(10);
  view.run({ type: 'setAlignment', align: 'left' });
  expect(view.listed()).toBe(1);
  expect(compareFresh(view).bars).toBe(1);
});

test('accept all, then another view and back', () => {
  using view = mount(CHANGES);
  view.acceptAll();
  view.surface.setEditingMode('suggest');
  view.select(10, 0, 9);
  view.run({ type: 'toggleMark', mark: 'bold' });
  view.run({ type: 'setReviewDisplayMode', mode: 'simple-markup' });
  compareFresh(view, { mode: 'simple-markup' });
  view.run({ type: 'setReviewDisplayMode', mode: 'all-markup' });
  expect(compareFresh(view).marked.join('')).toBe('Paragraph');
});

test('a styles change while the key is kept', () => {
  using view = mount(CHANGES);
  view.acceptAll();
  // The first hyperlink adds its character style to the styles.
  view.select(20, 0, 9);
  view.run({ type: 'insertHyperlink', href: 'https://example.com' });
  compareFresh(view);
  view.surface.setEditingMode('suggest');
  view.select(22);
  view.run({ type: 'setAlignment', align: 'left' });
  expect(view.listed()).toBe(0);
  compareFresh(view);
});

test('a numbering change while the key is kept', () => {
  using view = mount(CHANGES);
  view.acceptAll();
  view.select(20);
  view.run({ type: 'toggleList', kind: 'ordered' });
  compareFresh(view);
  view.surface.setEditingMode('suggest');
  view.select(22);
  view.run({ type: 'setAlignment', align: 'left' });
  expect(view.listed()).toBe(0);
  compareFresh(view);
  view.run({ type: 'undo' });
  view.run({ type: 'undo' });
  compareFresh(view);
});

test('a change of the author filter while the key is kept', () => {
  using view = mount(CHANGES);
  view.acceptAll();
  view.surface.setEditingMode('suggest');
  view.select(10);
  view.run({ type: 'setAlignment', align: 'center' });
  view.editor.setReviewAuthorVisible('Ada', false);
  expect(compareFresh(view, { hidden: ['Ada'] }).bars).toBe(0);
  view.editor.setReviewAuthorVisible('Ada', true);
  expect(compareFresh(view).bars).toBe(1);
});

test('a paragraph with the record inside a table cell', () => {
  using view = mount(new Map([...CHANGES, [40, { block: TABLE_WITH_RECORD }]]));
  // A record in a table cell always has a card.
  expect(view.listed()).toBe(CHANGES.size);
  expect(compareFresh(view).bars).toBe(CHANGES.size);
  view.acceptAll();
  expect(compareFresh(view)).toMatchObject({ bars: 0, marked: [] });
  view.run({ type: 'undo' });
  expect(compareFresh(view).bars).toBe(CHANGES.size);
});

for (const kept of [false, true]) {
  const name = kept ? 'under the kept key' : 'beside another left-out record';
  test(`a record split over paragraphs loses its card ${name}`, () => {
    using view = mount(new Map([...SPLIT_RECORD, [60, { properties: INERT }]]));
    expect(view.listed()).toBe(1);
    expect(compareFresh(view).bars).toBe(2);
    if (kept) {
      // The one left-out record gets a card, so the queue leaves nothing out.
      view.select(60);
      view.run({ type: 'setAlignment', align: 'center' });
      expect(view.listed()).toBe(2);
      expect(compareFresh(view).bars).toBe(3);
    }
    // The bold run goes, and with it the only site of the record that changed anything. The
    // first paragraph did not change, and its site is now left out.
    view.select(32, 'lead '.length, 'lead '.length + SPLIT_RECORD_TEXT.length);
    view.run({ type: 'deleteText' });
    expect(view.listed()).toBe(kept ? 1 : 0);
    expect(compareFresh(view).bars).toBe(kept ? 1 : 0);
  });
}

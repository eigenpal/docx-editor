// Accepting every change lays out only what changed, and so does each edit after it. The queue
// leaves out property changes that change nothing, and its last such record goes with the
// accept; the paragraphs that held no change must keep their measured lines through that.
//
// Each test records across the accept, so it fails when the accept lays the document out
// again, whichever later step it is about.

import { expect, test } from 'bun:test';
import {
  CHANGES,
  INERT,
  PARAGRAPHS,
  measuredOutside,
  mount,
} from './accept-all-layout-reuse-fixture.ts';

test('accept all measures only the paragraphs that held a change', () => {
  using view = mount(CHANGES);
  // The inert record has no card; each other change has one.
  expect(view.listed()).toBe(CHANGES.size - 1);
  const fullPasses = view.surface.state().perf.fullPasses;
  expect(measuredOutside(view, CHANGES.keys(), () => view.acceptAll())).toEqual([]);
  expect(view.listed()).toBe(0);
  // The pass resumed at the first change. It did not lay the document out from the top.
  const perf = view.surface.state().perf;
  expect(perf.fullPasses).toBe(fullPasses);
  expect(perf.placed).toBeLessThan(perf.total / 2);
});

test('accept all, undo, and redo measure only the paragraphs that held a change', () => {
  using view = mount(CHANGES);
  const outside = measuredOutside(view, CHANGES.keys(), () => {
    view.acceptAll();
    view.run({ type: 'undo' });
    expect(view.listed()).toBe(CHANGES.size - 1);
    view.run({ type: 'redo' });
    expect(view.listed()).toBe(0);
  });
  expect(outside).toEqual([]);
});

test('a tracked format change after accept all measures only its paragraph', () => {
  using view = mount(CHANGES);
  view.surface.setEditingMode('suggest');
  const outside = measuredOutside(view, [...CHANGES.keys(), 10], () => {
    view.acceptAll();
    view.select(10);
    view.run({ type: 'setAlignment', align: 'center' });
    expect(view.listed()).toBe(1);
  });
  expect(outside).toEqual([]);
  // A second one, in another paragraph, measures that paragraph and no other.
  view.select(12, 0, 9);
  const second = measuredOutside(view, [], () => view.run({ type: 'toggleMark', mark: 'bold' }));
  expect(second).toEqual([view.ids[12]!]);
});

test('a tracked format change with no effect after accept all measures only its paragraph', () => {
  using view = mount(CHANGES);
  view.surface.setEditingMode('suggest');
  const outside = measuredOutside(view, [...CHANGES.keys(), 14], () => {
    view.acceptAll();
    view.select(14);
    // The paragraph is left-aligned already, so the queue leaves this record out.
    view.run({ type: 'setAlignment', align: 'left' });
    expect(view.listed()).toBe(0);
  });
  expect(outside).toEqual([]);
});

test('a left-out record that gets a card measures only its paragraph', () => {
  using view = mount(new Map([[60, { properties: INERT }]]));
  expect(view.listed()).toBe(0);
  view.select(60);
  // The recorded change is now a real one: the paragraph was left-aligned and is centered.
  const outside = measuredOutside(view, [60], () =>
    view.run({ type: 'setAlignment', align: 'center' })
  );
  expect(view.listed()).toBe(1);
  expect(outside).toEqual([]);
});

test('the kept key holds through a change of view and back', () => {
  using view = mount(CHANGES);
  expect(measuredOutside(view, CHANGES.keys(), () => view.acceptAll())).toEqual([]);
  view.run({ type: 'setReviewDisplayMode', mode: 'simple-markup' });
  // Every block is still cached under the key the view had before.
  const back = measuredOutside(view, [], () =>
    view.run({ type: 'setReviewDisplayMode', mode: 'all-markup' })
  );
  expect(back).toEqual([]);
});

test('the reviewer filter is part of the key, kept or not', () => {
  using view = mount(CHANGES);
  expect(measuredOutside(view, CHANGES.keys(), () => view.acceptAll())).toEqual([]);
  const hidden = measuredOutside(view, [], () =>
    view.editor.setReviewAuthorVisible('Grace', false)
  );
  expect(hidden.length).toBe(PARAGRAPHS);
  // Every block is still cached under the kept key of the first reviewer filter.
  const shown = measuredOutside(view, [], () => view.editor.setReviewAuthorVisible('Grace', true));
  expect(shown).toEqual([]);
});

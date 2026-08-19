// The surface never lets a collapsed caret rest inside deleted content.
//
// A click on struck text resolves to the character under the pointer — an offset no caret
// stop owns. Left there, the caret was dead to every arrow key, and the next keystroke
// inserted characters INSIDE the deletion: text that exists in neither the original nor the
// proposed document. `setSelection` snaps a collapsed caret to the start of the deleted
// region; ranges pass through so a drag can still cover struck text.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test, afterEach } from 'bun:test';
import { mount } from './paginated-surface-fixtures.ts';

afterEach(() => {
  document.getSelection()?.removeAllRanges();
});

/** `AB` + deleted `CDE` + `FG` — model offsets 0..7, with 2..5 deleted. */
const MIXED =
  '<w:p><w:r><w:t>AB</w:t></w:r>' +
  '<w:del w:id="1" w:author="Dev" w:date="2026-03-26T11:00:00Z">' +
  '<w:r><w:delText>CDE</w:delText></w:r></w:del>' +
  '<w:r><w:t>FG</w:t></w:r></w:p>';

describe('collapsed carets and deleted content', () => {
  test('a collapsed caret inside a deletion snaps to the region start', () => {
    const { surface } = mount(MIXED);
    const paragraphId = surface.session.paragraphIds()[0]!;
    surface.setSelection({
      anchor: { paragraphId, offset: 3 },
      head: { paragraphId, offset: 3 },
    });
    expect(surface.state().selection.head.offset).toBe(2);
  });

  test('arrow keys work from the snapped caret', () => {
    const { surface } = mount(MIXED);
    const paragraphId = surface.session.paragraphIds()[0]!;
    surface.setSelection({
      anchor: { paragraphId, offset: 4 },
      head: { paragraphId, offset: 4 },
    });
    surface.navigate('right');
    expect(surface.state().selection.head.offset).toBe(5);
    surface.navigate('left');
    expect(surface.state().selection.head.offset).toBe(2);
  });

  test('typing after a click on struck text never lands inside the deletion', () => {
    const { surface } = mount(MIXED);
    const paragraphId = surface.session.paragraphIds()[0]!;
    surface.setSelection({
      anchor: { paragraphId, offset: 3 },
      head: { paragraphId, offset: 3 },
    });
    surface.type('X');
    // Inserted at the region start: before the deletion, never inside `w:delText`.
    expect(surface.session.bodyText()).toBe('ABXCDEFG');
  });

  test('word navigation crosses a deletion instead of dying at its edge', () => {
    // The word walk over the full paragraph text can target an offset inside the deletion;
    // unclamped, the snap bounced it back to where it started and Ctrl/Alt+Right was dead.
    const body =
      '<w:p><w:r><w:t xml:space="preserve">AB </w:t></w:r>' +
      '<w:del w:id="1" w:author="Dev" w:date="2026-03-26T11:00:00Z">' +
      '<w:r><w:delText xml:space="preserve">CD EF </w:delText></w:r></w:del>' +
      '<w:r><w:t>GH</w:t></w:r></w:p>';
    const { surface } = mount(body);
    const paragraphId = surface.session.paragraphIds()[0]!;
    surface.setSelection({
      anchor: { paragraphId, offset: 3 },
      head: { paragraphId, offset: 3 },
    });
    surface.navigate('wordRight');
    expect(surface.state().selection.head.offset).toBe(9);
    surface.navigate('wordLeft');
    expect(surface.state().selection.head.offset).toBe(3);
  });

  test('a range over deleted text passes through untouched', () => {
    const { surface } = mount(MIXED);
    const paragraphId = surface.session.paragraphIds()[0]!;
    const range = {
      anchor: { paragraphId, offset: 2 },
      head: { paragraphId, offset: 4 },
    };
    surface.setSelection(range);
    expect(surface.state().selection.head.offset).toBe(4);
  });
});

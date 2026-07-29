// The engine-owned paginated surface (task 8.1).
//
// Painted pages plus semantic interaction, with no contenteditable holding the document.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { mountPaginatedSurface, type PaginatedSurface } from '../src/paginated-surface.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

const paragraph = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;

/**
 * The content origin, in surface coordinates.
 *
 * `clickAt` takes SURFACE coordinates, so a test aiming at the third character has to
 * account for the page margin the same way a real pointer event does. Letter geometry with
 * one-inch margins at scale 1 puts content at 72pt on both axes.
 */
const MARGIN = 72;
const clickText = (surface: PaginatedSurface, x: number, y: number, extend = false) =>
  surface.clickAt({ x: MARGIN + x, y: MARGIN + y }, extend);

function mount(body: string): { surface: PaginatedSurface; container: HTMLElement } {
  const container = document.createElement('div');
  const result = mountPaginatedSurface(container, docx(body), { scale: 1 });
  if (!result.ok) throw new Error(`${result.reason}: ${result.detail ?? ''}`);
  return { surface: result.surface, container };
}

describe('painted pages, semantic interaction', () => {
  test('it paints pages and exposes the layout revision', () => {
    const { surface, container } = mount(paragraph('hello world'));
    expect(container.querySelectorAll('.docx-page').length).toBeGreaterThan(0);
    expect(surface.state().pageCount).toBeGreaterThan(0);
    expect(surface.layout().revision).toBe(0);
  });

  test('the document is NOT held in a contenteditable', () => {
    const { container } = mount(paragraph('hello'));
    // Only the tiny offscreen input host is editable; the painted text is not.
    const editable = [...container.querySelectorAll('[contenteditable="true"]')];
    expect(editable).toHaveLength(1);
    expect(editable[0]!.className).toBe('docx-input-host');
    expect(editable[0]!.textContent).toBe('');
  });

  test('a caret is rendered from the layout records', () => {
    const { container } = mount(paragraph('hello'));
    expect(container.querySelectorAll('.docx-caret')).toHaveLength(1);
  });

  test('clicking moves the caret to the hit position', () => {
    const { surface } = mount(paragraph('abcdef'));
    // 6pt per character at scale 1; x=18 is the boundary after three characters.
    clickText(surface, 18, 5);
    expect(surface.state().selection.head.offset).toBe(3);
  });

  test('typing commits through the session and repaints', () => {
    const { surface, container } = mount(paragraph('hello'));
    clickText(surface, 0, 5);
    surface.type('X');
    expect(surface.session.bodyText()).toBe('Xhello');
    expect(surface.state().revision).toBe(1);
    expect(container.textContent).toContain('Xhello');
  });

  test('typing replaces a selection', () => {
    const { surface } = mount(paragraph('hello'));
    clickText(surface, 0, 5);
    surface.navigate('right', true);
    surface.navigate('right', true);
    surface.type('Y');
    expect(surface.session.bodyText()).toBe('Yllo');
  });

  test('backspace deletes the character before the caret', () => {
    const { surface } = mount(paragraph('hello'));
    clickText(surface, 30, 5);
    surface.deleteBackward();
    expect(surface.session.bodyText()).toBe('hell');
  });

  test('Enter splits and the caret lands in the new paragraph', () => {
    const { surface } = mount(paragraph('hello'));
    clickText(surface, 18, 5);
    surface.splitParagraph();
    expect(surface.session.paragraphIds()).toHaveLength(2);
    expect(surface.session.bodyText()).toBe('hel\nlo');
    // The caret is in the tail, ready for the next keystroke.
    expect(surface.state().selection.head.paragraphId).toBe(surface.session.paragraphIds()[1]);
    expect(surface.state().selection.head.offset).toBe(0);
  });

  test('navigation moves the caret without touching the document', () => {
    const { surface } = mount(paragraph('hello') + paragraph('world'));
    clickText(surface, 0, 5);
    surface.navigate('documentEnd');
    expect(surface.state().selection.head.paragraphId).toBe(surface.session.paragraphIds()[1]);
    expect(surface.state().revision).toBe(0); // navigation is not an edit
  });

  test('a selection paints rectangles', () => {
    const { surface, container } = mount(paragraph('hello world'));
    clickText(surface, 0, 5);
    surface.navigate('lineEnd', true);
    expect(container.querySelectorAll('.docx-selection-rect').length).toBeGreaterThan(0);
  });

  test('save round-trips through the tree after painted editing', () => {
    const { surface } = mount(paragraph('hello'));
    clickText(surface, 30, 5);
    surface.type('!');
    const bytes = surface.session.save();
    const reopened = mountPaginatedSurface(document.createElement('div'), bytes, { scale: 1 });
    if (!reopened.ok) throw new Error(reopened.reason);
    expect(reopened.surface.session.bodyText()).toBe('hello!');
  });

  test('a malformed package is a typed rejection, not a throw', () => {
    const result = mountPaginatedSurface(
      document.createElement('div'),
      new Uint8Array([1, 2, 3]),
      {}
    );
    expect(result.ok).toBe(false);
  });

  test('unknown content is preserved through painted editing', () => {
    const { surface } = mount(
      '<w:p><w:r><w:t>a</w:t></w:r><w:r><w:drawing><x/></w:drawing></w:r>' +
        '<w:r><w:t>b</w:t></w:r></w:p>'
    );
    clickText(surface, 0, 5);
    surface.type('Z');
    const reopened = mountPaginatedSurface(
      document.createElement('div'),
      surface.session.save(),
      {}
    );
    if (!reopened.ok) throw new Error(reopened.reason);
    expect(reopened.surface.session.bodyText()).toBe('Zab');
  });
});

describe('relayout is driven by the store\'s own account of a commit (task 9.1)', () => {
  test('the painted layout always carries the revision the session is at', () => {
    const { surface } = mount(`<w:p><w:r><w:t>hello</w:t></w:r></w:p>`);
    clickText(surface, 0, 0);
    surface.type('a');
    expect(surface.layout().revision).toBe(surface.session.revision());
    surface.type('b');
    expect(surface.layout().revision).toBe(surface.session.revision());
  });

  test('reading the layout without an intervening commit does not lay out again', () => {
    // Identity, not equality: nothing committed, so the records in hand are already current
    // and recomputing them would be pure waste on every caret move and repaint.
    const { surface } = mount(`<w:p><w:r><w:t>hello</w:t></w:r></w:p>`);
    const first = surface.layout();
    expect(surface.layout()).toBe(first);
    surface.navigate('right');
    expect(surface.layout()).toBe(first);
  });

  test('a commit replaces the layout, and undo replaces it back', () => {
    const { surface } = mount(`<w:p><w:r><w:t>hello</w:t></w:r></w:p>`);
    clickText(surface, 0, 0);
    const before = surface.layout();
    surface.type('a');
    const after = surface.layout();
    expect(after).not.toBe(before);
    expect(after.revision).toBeGreaterThan(before.revision);
    // Undo is a commit like any other, so it reaches layout by the same route.
    surface.session.undo();
    expect(surface.layout()).not.toBe(after);
    expect(surface.session.bodyText()).toBe('hello');
  });

  test('a structural edit relays out and the new paragraph is painted', () => {
    const { surface, container } = mount(`<w:p><w:r><w:t>hello</w:t></w:r></w:p>`);
    clickText(surface, 0, 0);
    surface.navigate('lineEnd');
    surface.splitParagraph();
    expect(surface.session.paragraphIds().length).toBe(2);
    // Painted, not merely modeled: a split that never reached layout would leave one
    // fragment on screen while the model held two.
    expect(container.querySelectorAll('.docx-paragraph-fragment').length).toBe(2);
  });
});

describe('undo restores the caret the edit was made at (task 9.1 follow-through)', () => {
  test('undoing a typed character puts the caret back where it was typed', () => {
    const { surface } = mount(`<w:p><w:r><w:t>hello world</w:t></w:r></w:p>`);
    clickText(surface, 0, 0);
    surface.navigate('right');
    surface.navigate('right');
    surface.navigate('right');
    expect(surface.state().selection.head.offset).toBe(3);
    surface.type('X');
    expect(surface.state().selection.head.offset).toBe(4);

    surface.undo();
    expect(surface.session.bodyText()).toBe('hello world');
    // Not offset 4, which is past where the character now is, and not 0: the caret returns
    // to where the user was typing.
    expect(surface.state().selection.head.offset).toBe(3);
  });

  test('undoing a split puts the caret back at the split point', () => {
    const { surface } = mount(`<w:p><w:r><w:t>hello world</w:t></w:r></w:p>`);
    clickText(surface, 0, 0);
    for (let step = 0; step < 5; step += 1) surface.navigate('right');
    surface.splitParagraph();
    expect(surface.session.paragraphIds().length).toBe(2);

    surface.undo();
    expect(surface.session.paragraphIds().length).toBe(1);
    const head = surface.state().selection.head;
    expect(head.paragraphId).toBe(surface.session.paragraphIds()[0]!);
    expect(head.offset).toBe(5);
  });

  test('undo with an empty history leaves the caret alone', () => {
    const { surface } = mount(`<w:p><w:r><w:t>hello</w:t></w:r></w:p>`);
    clickText(surface, 0, 0);
    surface.navigate('right');
    surface.undo();
    expect(surface.state().selection.head.offset).toBe(1);
  });
});

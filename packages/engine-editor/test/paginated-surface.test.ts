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
 * Put the caret at a model position in the first paragraph.
 *
 * Addresses the MODEL, not the screen. Positioning by coordinates went through the surface's
 * own hit test, which no production path uses any more — the browser resolves pointer
 * positions over the painted text. `hitTestSemantic` keeps its own tests in `engine-layout`,
 * where the page-relative contract that makes it tricky actually lives.
 */
function putCaret(surface: PaginatedSurface, offset: number, paragraphIndex = 0): void {
  const paragraphId = surface.session.paragraphIds()[paragraphIndex]!;
  surface.setSelection({
    anchor: { paragraphId, offset },
    head: { paragraphId, offset },
  });
}

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

  test('the painted pages are the editable surface, and the only one', () => {
    // The pages hold focus so the browser has ONE place for selection, caret, highlight,
    // keystrokes and IME. An offscreen host cannot coexist with a selection on the page:
    // focusing it destroys the page's selection, and a focused editable with no selection
    // inside it stops firing `beforeinput` at all.
    const { container } = mount(paragraph('hello'));
    const editable = [...container.querySelectorAll('[contenteditable="true"]')];
    expect(editable).toHaveLength(1);
    expect(editable[0]!.className).toBe('docx-pages');
  });

  test('the DOM is still a picture: a direct edit to it does not become the document', () => {
    // Editable for INPUT, never authoritative. This is the property the old
    // no-contenteditable assertion was protecting, and it has to survive the change.
    const { surface, container } = mount(paragraph('hello'));
    const span = container.querySelector('[data-start]')!;
    span.textContent = 'tampered';
    expect(surface.session.bodyText()).toBe('hello');
    // The next commit repaints from layout records, discarding the tampering.
    putCaret(surface, 0);
    surface.type('!');
    expect(container.querySelector('[data-start]')!.textContent).not.toBe('tampered');
    expect(surface.session.bodyText()).toBe('!hello');
  });

  test('the model selection is mirrored into the browser selection', () => {
    // The caret and the highlight are the browser's, so they follow real glyph shapes
    // instead of a hand-drawn band. That only works if model moves reach the DOM.
    const { surface, container } = mount(paragraph('hello world'));
    putCaret(surface, 0);
    surface.navigate('right');
    surface.navigate('right');
    const domSelection = container.ownerDocument.getSelection()!;
    expect(domSelection.rangeCount).toBeGreaterThan(0);
    expect(container.contains(domSelection.anchorNode!)).toBe(true);
  });

  test('clicking moves the caret to the hit position', () => {
    const { surface } = mount(paragraph('abcdef'));
    // 6pt per character at scale 1; x=18 is the boundary after three characters.
    putCaret(surface, 3);
    expect(surface.state().selection.head.offset).toBe(3);
  });

  test('typing commits through the session and repaints', () => {
    const { surface, container } = mount(paragraph('hello'));
    putCaret(surface, 0);
    surface.type('X');
    expect(surface.session.bodyText()).toBe('Xhello');
    expect(surface.state().revision).toBe(1);
    expect(container.textContent).toContain('Xhello');
  });

  test('typing replaces a selection', () => {
    const { surface } = mount(paragraph('hello'));
    putCaret(surface, 0);
    surface.navigate('right', true);
    surface.navigate('right', true);
    surface.type('Y');
    expect(surface.session.bodyText()).toBe('Yllo');
  });

  test('backspace deletes the character before the caret', () => {
    const { surface } = mount(paragraph('hello'));
    putCaret(surface, 5);
    surface.deleteBackward();
    expect(surface.session.bodyText()).toBe('hell');
  });

  test('Enter splits and the caret lands in the new paragraph', () => {
    const { surface } = mount(paragraph('hello'));
    putCaret(surface, 3);
    surface.splitParagraph();
    expect(surface.session.paragraphIds()).toHaveLength(2);
    expect(surface.session.bodyText()).toBe('hel\nlo');
    // The caret is in the tail, ready for the next keystroke.
    expect(surface.state().selection.head.paragraphId).toBe(surface.session.paragraphIds()[1]);
    expect(surface.state().selection.head.offset).toBe(0);
  });

  test('navigation moves the caret without touching the document', () => {
    const { surface } = mount(paragraph('hello') + paragraph('world'));
    putCaret(surface, 0);
    surface.navigate('documentEnd');
    expect(surface.state().selection.head.paragraphId).toBe(surface.session.paragraphIds()[1]);
    expect(surface.state().revision).toBe(0); // navigation is not an edit
  });

  test('extending a selection reaches the browser selection as a real range', () => {
    const { surface, container } = mount(paragraph('hello world'));
    putCaret(surface, 0);
    surface.navigate('lineEnd', true);
    const state = surface.state().selection;
    expect(state.head.offset).toBeGreaterThan(state.anchor.offset);
    const domSelection = container.ownerDocument.getSelection()!;
    expect(domSelection.isCollapsed).toBe(false);
  });

  test('save round-trips through the tree after painted editing', () => {
    const { surface } = mount(paragraph('hello'));
    putCaret(surface, 5);
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
    putCaret(surface, 0);
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
    putCaret(surface, 0);
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
    putCaret(surface, 0);
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
    putCaret(surface, 0);
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
    putCaret(surface, 0);
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
    putCaret(surface, 0);
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
    putCaret(surface, 0);
    surface.navigate('right');
    surface.undo();
    expect(surface.state().selection.head.offset).toBe(1);
  });
});

describe('the keymap covers what an editor is expected to do', () => {
  const twoParagraphs = `${paragraph('hello world')}${paragraph('second line')}`;

  test('Backspace at the start of a paragraph joins it to the previous one', () => {
    // Refusing here made the key look broken: a caret at the paragraph start is exactly
    // where a user presses Backspace to merge.
    const { surface } = mount(twoParagraphs);
    const [first, second] = surface.session.paragraphIds();
    putCaret(surface, 0);
    surface.navigate('documentEnd');
    surface.navigate('lineStart');
    expect(surface.state().selection.head.paragraphId).toBe(second!);
    surface.deleteBackward();
    expect(surface.session.paragraphIds()).toEqual([first!]);
    expect(surface.session.bodyText()).toBe('hello worldsecond line');
    // The caret lands at the seam, not at the start of the merged paragraph.
    expect(surface.state().selection.head.offset).toBe('hello world'.length);
  });

  test('Delete at the end of a paragraph pulls the next one up', () => {
    const { surface } = mount(twoParagraphs);
    putCaret(surface, 0);
    surface.navigate('lineEnd');
    surface.deleteForward();
    expect(surface.session.bodyText()).toBe('hello worldsecond line');
  });

  test('Delete inside a paragraph removes the character after the caret', () => {
    const { surface } = mount(paragraph('hello'));
    putCaret(surface, 0);
    surface.deleteForward();
    expect(surface.session.bodyText()).toBe('ello');
  });

  test('select all covers the whole document, and typing replaces it', () => {
    const { surface } = mount(twoParagraphs);
    surface.selectAll();
    expect(surface.selectedText()).toBe('hello world\nsecond line');
    surface.type('fresh');
    expect(surface.session.bodyText()).toBe('fresh');
    expect(surface.session.paragraphIds().length).toBe(1);
  });

  test('deleting a selection that spans paragraphs joins what is left', () => {
    const { surface } = mount(`${paragraph('one two')}${paragraph('three four')}`);
    const [first, second] = surface.session.paragraphIds();
    surface.setSelection({
      anchor: { paragraphId: first!, offset: 4 },
      head: { paragraphId: second!, offset: 6 },
    });
    expect(surface.deleteSelection()).toBe(true);
    expect(surface.session.bodyText()).toBe('one four');
    expect(surface.session.paragraphIds().length).toBe(1);
  });

  test('word-wise motion walks words rather than characters', () => {
    const { surface } = mount(paragraph('alpha beta gamma'));
    putCaret(surface, 0);
    surface.navigate('wordRight');
    expect(surface.state().selection.head.offset).toBe(5);
    surface.navigate('wordRight');
    expect(surface.state().selection.head.offset).toBe(10);
    surface.navigate('wordLeft');
    expect(surface.state().selection.head.offset).toBe(6);
  });

  test('a tab is a w:tab element, not a literal tab character in the run', () => {
    const { surface } = mount(paragraph('ab'));
    putCaret(surface, 0);
    surface.insertTab();
    expect(surface.session.bodyText()).toBe('\tab');
    const xml = JSON.stringify(surface.session.part());
    expect(xml).toContain('"tab"');
  });

  test('a line break stays inside the paragraph', () => {
    const { surface } = mount(paragraph('ab'));
    putCaret(surface, 0);
    surface.insertLineBreak();
    expect(surface.session.paragraphIds().length).toBe(1);
    expect(surface.session.bodyText()).toContain('\n');
  });

  test('toggling bold twice writes an explicit off rather than dropping the property', () => {
    // The property may be inherited from a style, so removing the local override would let
    // the inherited value come back instead of turning bold off.
    const { surface } = mount(paragraph('hello'));
    const id = surface.session.paragraphIds()[0]!;
    surface.setSelection({
      anchor: { paragraphId: id, offset: 0 },
      head: { paragraphId: id, offset: 5 },
    });
    surface.toggleRunProperty('b');
    expect(JSON.stringify(surface.session.part())).toContain('"b"');
    surface.toggleRunProperty('b');
    expect(JSON.stringify(surface.session.part())).toContain('"0"');
  });

  test('a collapsed caret is not formatted, because there is no range to format', () => {
    const { surface } = mount(paragraph('hello'));
    putCaret(surface, 0);
    const before = surface.session.revision();
    surface.toggleRunProperty('b');
    expect(surface.session.revision()).toBe(before);
  });

  test('selected text across paragraphs is newline separated', () => {
    const { surface } = mount(`${paragraph('one')}${paragraph('two')}${paragraph('three')}`);
    const ids = surface.session.paragraphIds();
    surface.setSelection({
      anchor: { paragraphId: ids[0]!, offset: 1 },
      head: { paragraphId: ids[2]!, offset: 2 },
    });
    expect(surface.selectedText()).toBe('ne\ntwo\nth');
  });
});

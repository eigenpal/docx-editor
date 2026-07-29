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
    surface.clickAt({ x: 18, y: 5 });
    expect(surface.state().selection.head.offset).toBe(3);
  });

  test('typing commits through the session and repaints', () => {
    const { surface, container } = mount(paragraph('hello'));
    surface.clickAt({ x: 0, y: 5 });
    surface.type('X');
    expect(surface.session.bodyText()).toBe('Xhello');
    expect(surface.state().revision).toBe(1);
    expect(container.textContent).toContain('Xhello');
  });

  test('typing replaces a selection', () => {
    const { surface } = mount(paragraph('hello'));
    surface.clickAt({ x: 0, y: 5 });
    surface.navigate('right', true);
    surface.navigate('right', true);
    surface.type('Y');
    expect(surface.session.bodyText()).toBe('Yllo');
  });

  test('backspace deletes the character before the caret', () => {
    const { surface } = mount(paragraph('hello'));
    surface.clickAt({ x: 30, y: 5 });
    surface.deleteBackward();
    expect(surface.session.bodyText()).toBe('hell');
  });

  test('Enter splits and the caret lands in the new paragraph', () => {
    const { surface } = mount(paragraph('hello'));
    surface.clickAt({ x: 18, y: 5 });
    surface.splitParagraph();
    expect(surface.session.paragraphIds()).toHaveLength(2);
    expect(surface.session.bodyText()).toBe('hel\nlo');
    // The caret is in the tail, ready for the next keystroke.
    expect(surface.state().selection.head.paragraphId).toBe(surface.session.paragraphIds()[1]);
    expect(surface.state().selection.head.offset).toBe(0);
  });

  test('navigation moves the caret without touching the document', () => {
    const { surface } = mount(paragraph('hello') + paragraph('world'));
    surface.clickAt({ x: 0, y: 5 });
    surface.navigate('documentEnd');
    expect(surface.state().selection.head.paragraphId).toBe(surface.session.paragraphIds()[1]);
    expect(surface.state().revision).toBe(0); // navigation is not an edit
  });

  test('a selection paints rectangles', () => {
    const { surface, container } = mount(paragraph('hello world'));
    surface.clickAt({ x: 0, y: 5 });
    surface.navigate('lineEnd', true);
    expect(container.querySelectorAll('.docx-selection-rect').length).toBeGreaterThan(0);
  });

  test('save round-trips through the tree after painted editing', () => {
    const { surface } = mount(paragraph('hello'));
    surface.clickAt({ x: 30, y: 5 });
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
    surface.clickAt({ x: 0, y: 5 });
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

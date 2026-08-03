// Scrolling to a page or a block, from the LAYOUT rather than from the DOM.
//
// `scrollToPage`/`scrollToBlock` were declared on the editor contract and stubbed to
// `false`, so the outline could select a heading twenty pages down and leave the user
// looking at page one. The geometry has to come from the records: the page a reveal is
// asked for is usually one that has not been materialized yet, so there is no element to
// measure — which is exactly why reaching into the DOM cannot answer this.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

/** Enough paragraphs to paginate well past one screen. */
const BODY = Array.from(
  { length: 120 },
  (_, index) => `<w:p><w:r><w:t>paragraph ${index}</w:t></w:r></w:p>`
).join('');

function docx(): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${BODY}</w:body></w:document>`
    ),
  });
}

/** A mounted editor inside a real scroll container, sized so pages fall out of view. */
function mount(): { editor: DocxEditorInstance; scroller: HTMLElement } {
  const scroller = document.createElement('div');
  scroller.className = 'docx-editor__scroll-container';
  const container = document.createElement('div');
  scroller.append(container);
  document.body.append(scroller);
  // happy-dom reports 0 for layout metrics, so the scroll geometry is stated here the way
  // a real viewport would report it.
  Object.defineProperty(scroller, 'clientHeight', { value: 600, configurable: true });
  Object.defineProperty(scroller, 'scrollHeight', { value: 100_000, configurable: true });
  let scrollTop = 0;
  Object.defineProperty(scroller, 'scrollTop', {
    get: () => scrollTop,
    set: (next: number) => {
      scrollTop = next;
    },
    configurable: true,
  });
  scroller.scrollTo = ((options: ScrollToOptions) => {
    scrollTop = options.top ?? 0;
  }) as HTMLElement['scrollTo'];
  const editor = createDocxEditor({ container, document: docx() });
  if (!editor.surface) throw new Error('surface failed to mount');
  return { editor, scroller };
}

describe('scrollToPage / scrollToBlock actually scroll', () => {
  test('a later page scrolls into view and reports that it did', () => {
    const { editor, scroller } = mount();
    expect(editor.getTotalPages()).toBeGreaterThan(1);
    expect(scroller.scrollTop).toBe(0);
    expect(editor.scrollToPage(2)).toBe(true);
    expect(scroller.scrollTop).toBeGreaterThan(0);
    editor.destroy();
  });

  test('page numbers are 1-based, and an out-of-range one is refused rather than clamped', () => {
    const { editor, scroller } = mount();
    // Page 1 is the top of the document, so it is a real target that scrolls to zero.
    expect(editor.scrollToPage(1)).toBe(true);
    expect(scroller.scrollTop).toBe(0);
    expect(editor.scrollToPage(0)).toBe(false);
    expect(editor.scrollToPage(-1)).toBe(false);
    expect(editor.scrollToPage(9999)).toBe(false);
    expect(editor.scrollToPage(1.5)).toBe(false);
    editor.destroy();
  });

  test('a block on a later page scrolls to its own line, not merely its page', () => {
    const { editor, scroller } = mount();
    const ids = editor.surface!.session.paragraphIds();
    const last = ids[ids.length - 1]!;
    expect(editor.scrollToBlock(last)).toBe(true);
    const atLast = scroller.scrollTop;
    expect(atLast).toBeGreaterThan(0);
    // A paragraph EARLIER in the same document scrolls somewhere earlier — proving the
    // target is the block's own position rather than a constant.
    expect(editor.scrollToBlock(ids[Math.floor(ids.length / 2)]!)).toBe(true);
    expect(scroller.scrollTop).toBeLessThan(atLast);
    editor.destroy();
  });

  test('an unknown block is refused, so a caller can tell "no such target" from "done"', () => {
    const { editor } = mount();
    expect(editor.scrollToBlock('no-such-paragraph')).toBe(false);
    expect(editor.scrollToBlock('')).toBe(false);
    editor.destroy();
  });

  test('with no scroll container the surface refuses rather than pretending', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const editor = createDocxEditor({ container, document: docx() });
    expect(editor.scrollToPage(2)).toBe(false);
    editor.destroy();
  });
});

// WHO OWNS THE CARET AFTER A REPAINT.
//
// The model and the browser each hold a selection, and every repaint has to decide which of
// the two is the newer. A gesture the queued `selectionchange` has not delivered yet is the
// case the DOM wins; everything else the browser does to its own selection — re-resolving it
// onto a container after a paint replaced the nodes it lived in — is not a move anybody made.
//
// The companion of `selection-integrity.test.ts`, which pins what a DOM endpoint MEANS. This
// file pins who is allowed to act on one.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { paragraphTextOf } from '@docx-editor.dev/core/store';
import { applySelectionToDom } from '../dom-selection.ts';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

// The selection belongs to the DOCUMENT, which every suite in this process shares.
afterEach(() => {
  document.getSelection()?.removeAllRanges();
});

function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

/**
 * A painted paragraph that HAS text: two lines, each with one span.
 *
 * The distinction the write side turns on. A paragraph with painted spans and no place for an
 * offset must refuse; a paragraph with no spans at all still has its one caret position.
 */
function paintedParagraph(paragraphId: string): HTMLElement {
  const root = document.createElement('div');
  const fragment = document.createElement('div');
  fragment.className = 'docx-paragraph-fragment';
  fragment.dataset.paragraphId = paragraphId;
  for (const source of [
    { id: 'line-1', text: 'alpha ', start: 0 },
    { id: 'line-2', text: 'beta', start: 6 },
  ]) {
    const line = document.createElement('div');
    line.className = 'docx-line';
    line.dataset.lineId = source.id;
    line.dataset.paragraphId = paragraphId;
    const span = document.createElement('span');
    span.dataset.paragraphId = paragraphId;
    span.dataset.start = String(source.start);
    span.dataset.end = String(source.start + source.text.length);
    span.textContent = source.text;
    line.append(span);
    fragment.append(line);
  }
  root.append(fragment);
  return root;
}

// A REPAINT MAY CARRY A GESTURE; IT MAY NEVER INVENT ONE.
//
// An edit installs its post-edit caret and the first repaint mirrors it out. That repaint is
// not the only one: a settled image, a deferred publish, a scroll all repaint again while the
// caret this edit installed is still the newest thing anybody moved. Those later repaints read
// the browser's selection, and the browser's answer after a page's DOM has been rebuilt under
// it is a container — which reads back as the paragraph START. The reported shape: open the
// header, type there, click back into the body, then type at the end of a paragraph. The first
// character landed, the caret went home to offset 0, and every character after it was inserted
// in front of the one before, so "Hello" arrived as "elloH".
describe('a repaint never invents a selection the user did not make', () => {
  const body =
    '<w:p><w:r><w:t xml:space="preserve">alpha</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t xml:space="preserve">beta</w:t></w:r></w:p>';

  function mounted(): { surface: PaginatedSurface; container: HTMLElement } {
    const container = document.createElement('div');
    document.body.append(container);
    const opened = mountPaginatedSurface(container, docx(body), { scale: 1 });
    if (!opened.ok) throw new Error(opened.reason);
    return { surface: opened.surface, container };
  }

  test('a caret the paint cannot express is refused, not landed at the paragraph start', () => {
    // The write side of the same failure. A paragraph that painted text and has no place for
    // this offset — inside a hidden run, or past what the current paint covers — used to
    // answer the line element at child index 0. `applySelectionToDom` then reported success
    // for a caret sitting at the paragraph start, and the next reader took that as the truth.
    const root = paintedParagraph('p1');
    document.body.append(root);
    try {
      const beyond = { paragraphId: 'p1', offset: 40 };
      expect(
        applySelectionToDom(root, { anchor: beyond, head: beyond }, document.getSelection())
      ).toBe(false);
    } finally {
      root.remove();
    }
  });

  test('an empty paragraph still gets its one caret position', () => {
    // The refusal above must not take the case the fallback exists for: a paragraph with no
    // painted spans at all has exactly one caret position, and losing it means no caret after
    // every Enter.
    const root = document.createElement('div');
    const line = document.createElement('div');
    line.className = 'docx-line';
    line.dataset.lineId = 'line-1';
    line.dataset.paragraphId = 'p9';
    root.append(line);
    document.body.append(root);
    try {
      const caret = { paragraphId: 'p9', offset: 0 };
      expect(
        applySelectionToDom(root, { anchor: caret, head: caret }, document.getSelection())
      ).toBe(true);
    } finally {
      root.remove();
    }
  });

  test('a browser selection nobody gestured for does not move the caret an edit just set', async () => {
    const { surface, container } = mounted();
    try {
      const id = surface.session.paragraphIds()[0]!;
      surface.setSelection({
        anchor: { paragraphId: id, offset: 5 },
        head: { paragraphId: id, offset: 5 },
      });
      surface.type('!');
      expect(surface.state().selection.head.offset).toBe(6);

      // What a repaint leaves behind: the browser re-resolves its selection onto the line
      // container, which reads back as the paragraph START. No pointerdown, no selectstart —
      // nobody gestured, so this is the DOM being fixed up, not the user moving the caret.
      const line = container.querySelector<HTMLElement>(
        `[data-line-id][data-paragraph-id="${id}"]`
      )!;
      const selection = document.getSelection()!;
      selection.removeAllRanges();
      const range = document.createRange();
      range.setStart(line, 0);
      range.collapse(true);
      selection.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(surface.state().selection.head.offset).toBe(6);

      // The next keystroke arrives the way the browser delivers one, through the same
      // `beforeinput` that reads the DOM selection first. It must land AFTER the character
      // before it, not in front of it.
      const pages = container.querySelector('.docx-pages')!;
      pages.dispatchEvent(
        new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          inputType: 'insertText',
          data: '?',
        })
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(paragraphTextOf(surface.session.part(), id)).toBe('alpha!?');
    } finally {
      surface.destroy();
      container.remove();
    }
  });
});

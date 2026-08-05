// The engine's painted insertion point.
//
// Two things it has to be at once: a two-pixel cursor drawn at the geometry LAYOUT
// published, and something the selection machinery cannot see. The second is the part that
// breaks quietly — an element a DOM endpoint can resolve through puts every offset after it
// out by the length of a run.
//
// It also has to appear where the native caret does not. An empty paragraph paints no text
// span, so the browser has no inline box to size an insertion point against; `caretAt`
// resolves against the LINE record, which layout publishes either way, which is why
// pressing Enter now leaves a visible cursor instead of nothing.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { caretAt } from '@docx-editor.dev/core/layout';
import {
  mountPaginatedSurface,
  setPaginatedSurfaceScale,
  type PaginatedSurface,
} from '../paginated-surface.ts';
import { positionFromDomPoint } from '../dom-selection.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const NUM = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering';

const NUMBERING =
  `<w:numbering xmlns:w="${W}">` +
  '<w:abstractNum w:abstractNumId="0">' +
  '<w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/>' +
  '<w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>' +
  '</w:abstractNum>' +
  '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>';

function docx(body: string, withNumbering = false): Uint8Array {
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        (withNumbering
          ? '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>'
          : '') +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  };
  if (withNumbering) {
    files['word/numbering.xml'] = strToU8(NUMBERING);
    files['word/_rels/document.xml.rels'] = strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId9" Type="${NUM}" Target="numbering.xml"/></Relationships>`
    );
  }
  return zipSync(files);
}

const paragraph = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const listItem = (text: string) =>
  '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>' +
  `<w:r><w:t>${text}</w:t></w:r></w:p>`;

interface Mounted {
  readonly surface: PaginatedSurface;
  readonly container: HTMLElement;
  readonly pages: HTMLElement;
}

/**
 * Mount ATTACHED and FOCUSED: the caret is only painted while the surface holds focus, and
 * a detached element cannot become `document.activeElement`.
 */
function mount(body: string, withNumbering = false): Mounted {
  const container = document.createElement('div');
  document.body.append(container);
  const opened = mountPaginatedSurface(container, docx(body, withNumbering), { scale: 1 });
  if (!opened.ok) throw new Error(opened.reason);
  const pages = container.querySelector<HTMLElement>('.docx-pages')!;
  opened.surface.focus();
  return { surface: opened.surface, container, pages };
}

function putCaret(surface: PaginatedSurface, offset: number, paragraphIndex = 0): void {
  const paragraphId = surface.session.paragraphIds()[paragraphIndex]!;
  surface.setSelection({
    anchor: { paragraphId, offset },
    head: { paragraphId, offset },
  });
}

const caretElement = (container: HTMLElement) =>
  container.querySelector<HTMLElement>('.ep-one-surface__caret');

/** The caret's inline geometry, which is the only geometry it has. */
const geometryOf = (element: HTMLElement) => ({
  left: element.style.left,
  top: element.style.top,
  height: element.style.height,
});

describe('the painted caret', () => {
  test('it paints at the geometry layout published, not at a measured one', () => {
    const { surface, container } = mount(paragraph('hello world'));
    putCaret(surface, 6);

    const painted = caretElement(container);
    expect(painted).not.toBeNull();

    const expected = caretAt(surface.layout(), surface.state().selection.head)!;
    expect(expected).not.toBeNull();
    // Scale 1, so points and pixels coincide and the assertion stays about the SOURCE of
    // the numbers rather than about a conversion.
    expect(geometryOf(painted!)).toEqual({
      left: `${expected.x}px`,
      top: `${expected.y}px`,
      height: `${expected.height}px`,
    });
    // Painted into the page CONTENT box, which is the element whose coordinate space
    // `caretAt` answers in.
    expect(painted!.parentElement?.className).toBe('docx-page-content');
    expect(painted!.closest('[data-page-index]')?.getAttribute('data-page-index')).toBe(
      String(expected.pageIndex)
    );
  });

  test('it rescales with the surface without moving the semantic caret', () => {
    const { surface, container } = mount(paragraph('hello world'));
    putCaret(surface, 6);

    expect(setPaginatedSurfaceScale(surface, 2)).toBe(true);

    const expected = caretAt(surface.layout(), surface.state().selection.head)!;
    const painted = caretElement(container)!;
    expect(parseFloat(painted.style.left)).toBeCloseTo(expected.x * 2);
    expect(parseFloat(painted.style.height)).toBeCloseTo(expected.height * 2);
    surface.destroy();
  });

  test('it survives the dark page inversion it is painted inside', () => {
    const { surface, container } = mount(paragraph('hello world'));
    putCaret(surface, 6);
    // `.docx-page-content` is inverted wholesale in dark mode, so a caret painted inside it
    // has to opt out of the inversion the same way images and highlights do.
    expect(caretElement(container)!.hasAttribute('data-no-color-invert')).toBe(true);
  });

  test('it suppresses the native caret only while it is up', () => {
    const { surface, container, pages } = mount(paragraph('hello world'));
    putCaret(surface, 3);
    expect(pages.style.caretColor).toBe('transparent');

    surface.setSelection({
      anchor: { paragraphId: surface.session.paragraphIds()[0]!, offset: 1 },
      head: { paragraphId: surface.session.paragraphIds()[0]!, offset: 4 },
    });
    expect(caretElement(container)).toBeNull();
    expect(pages.style.caretColor).toBe('');
  });

  test('a range selection draws the browser highlight, never an insertion point', () => {
    const { surface, container } = mount(paragraph('hello world'));
    const paragraphId = surface.session.paragraphIds()[0]!;
    surface.setSelection({
      anchor: { paragraphId, offset: 0 },
      head: { paragraphId, offset: 5 },
    });
    expect(caretElement(container)).toBeNull();
  });

  test('it is FURNITURE: a selection endpoint cannot resolve through it', () => {
    const { surface, container, pages } = mount(paragraph('hello world'));
    putCaret(surface, 6);
    const painted = caretElement(container)!;

    // The refusal that matters. Without it a DOM endpoint landing on the caret would map
    // into the adjacent run and every offset after it would come back wrong.
    expect(positionFromDomPoint(painted, 0, pages)).toBeNull();
    expect(painted.getAttribute('contenteditable')).toBe('false');
    expect(painted.getAttribute('aria-hidden')).toBe('true');
    expect(painted.style.pointerEvents).toBe('none');
    expect(painted.style.userSelect).toBe('none');
    // It carries no span identity, so nothing that reads painted text can see it either.
    expect(painted.hasAttribute('data-paragraph-id')).toBe(false);
    expect(painted.hasAttribute('data-start')).toBe(false);
  });

  test('an IME composition gets the native caret back for its duration', () => {
    const { surface, container, pages } = mount(paragraph('hello world'));
    putCaret(surface, 5);
    expect(caretElement(container)).not.toBeNull();

    // `beforeinput` for composed text is not cancelable, so the browser owns the caret
    // while an input method is holding text; a painted one would sit beside the real
    // insertion point and the IME's own candidate window would anchor to nothing.
    pages.dispatchEvent(new Event('compositionstart'));
    expect(caretElement(container)).toBeNull();
    expect(pages.style.caretColor).toBe('');

    pages.dispatchEvent(new Event('compositionend'));
    expect(caretElement(container)).not.toBeNull();
    expect(pages.style.caretColor).toBe('transparent');
  });

  test('it holds steady while it is moving, then lets the blink resume', async () => {
    const { surface, container } = mount(paragraph('hello world'));
    putCaret(surface, 2);
    const painted = caretElement(container)!;
    // The stylesheet owns width, colour and the blink; the element only has to claim them.
    expect(painted.classList.contains('ep-one-surface__caret')).toBe(true);
    // A caret that keeps blinking under an arrow key or a drag disappears mid-gesture.
    expect(painted.classList.contains('ep-one-surface__caret--steady')).toBe(true);

    await Bun.sleep(700);
    expect(painted.classList.contains('ep-one-surface__caret--steady')).toBe(false);
    putCaret(surface, 7);
    expect(painted.classList.contains('ep-one-surface__caret--steady')).toBe(true);
  });

  test('an unfocused surface keeps the native caret and paints nothing', () => {
    const { surface, container, pages } = mount(paragraph('hello world'));
    putCaret(surface, 4);
    expect(caretElement(container)).not.toBeNull();

    const elsewhere = document.createElement('input');
    document.body.append(elsewhere);
    pages.dispatchEvent(new FocusEvent('focusout', { relatedTarget: elsewhere }));
    expect(caretElement(container)).toBeNull();
    expect(pages.style.caretColor).toBe('');
  });

  test('destroying the surface takes the caret and the suppression with it', () => {
    const { surface, container, pages } = mount(paragraph('hello world'));
    putCaret(surface, 2);
    surface.destroy();
    expect(caretElement(container)).toBeNull();
    expect(pages.style.caretColor).toBe('');
  });
});

describe('the caret on an empty paragraph', () => {
  test('a paragraph created by Enter is where the native caret cannot go', () => {
    const { surface, container } = mount(paragraph('hello'));
    putCaret(surface, 5);
    surface.splitParagraph();

    const head = surface.state().selection.head;
    // The point of the whole exercise: the new paragraph has no painted text span, so the
    // browser has no inline box to size an insertion point against and drew none at all.
    const spans = [...container.querySelectorAll('[data-paragraph-id][data-start]')].filter(
      (span) => (span as HTMLElement).dataset.paragraphId === head.paragraphId
    );
    expect(spans).toHaveLength(0);

    // Layout still places the line, so the engine's caret resolves and paints.
    const expected = caretAt(surface.layout(), head);
    expect(expected).not.toBeNull();
    const painted = caretElement(container);
    expect(painted).not.toBeNull();
    expect(geometryOf(painted!)).toEqual({
      left: `${expected!.x}px`,
      top: `${expected!.y}px`,
      height: `${expected!.height}px`,
    });
    // A real cursor, not a zero-height sliver: an empty paragraph's caret is the height of
    // the line its own font would have produced.
    expect(expected!.height).toBeGreaterThan(0);
  });

  test('a new EMPTY LIST ITEM gets one too, and it sits after the marker', () => {
    const { surface, container } = mount(listItem('alpha'), true);
    putCaret(surface, 5);
    surface.splitParagraph();

    const head = surface.state().selection.head;
    const expected = caretAt(surface.layout(), head);
    expect(expected).not.toBeNull();
    const painted = caretElement(container);
    expect(painted).not.toBeNull();
    expect(geometryOf(painted!)).toEqual({
      left: `${expected!.x}px`,
      top: `${expected!.y}px`,
      height: `${expected!.height}px`,
    });
    // The marker is furniture in the hanging indent and contributes no offsets, so the
    // caret belongs at the item's text origin — not at the paragraph box's left edge.
    expect(expected!.x).toBeGreaterThan(0);
  });

  test('a document that opens on an empty paragraph paints a caret at offset zero', () => {
    const { surface, container } = mount('<w:p/>');
    putCaret(surface, 0);
    const expected = caretAt(surface.layout(), surface.state().selection.head);
    expect(expected).not.toBeNull();
    expect(caretElement(container)).not.toBeNull();
  });
});

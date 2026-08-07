// Offset integrity for selections read back out of the painted DOM.
//
// The painted pages hold more than model text. A list marker, tab leaders, border rules,
// shading bands, the engine's own caret and header/footer furniture all live in the subtree
// the browser hands selection endpoints from, and none of them carries a source range. Each
// is therefore a way for a gesture to come back as the WRONG characters — or as NO
// characters, which is worse: an unmapped gesture used to leave the model holding the
// PREVIOUS selection while the browser showed the new one, so the next toolbar command
// formatted a range the user could no longer see.
//
// happy-dom cannot produce a native double-click, so these assert the INVARIANTS a real
// gesture depends on rather than the gesture: which endpoint shapes resolve, which are
// refused, and that a refusal never strands a stale model selection.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { applySelectionToDom, positionFromDomPoint } from '../dom-selection.ts';
import { paintedTextOf, paragraphReplacePlan } from '../surface-input.ts';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';

// The selection is a property of the DOCUMENT, and the happy-dom document is shared by every
// suite in the process. A selection left anchored in a still-attached element makes the next
// surface's `ownsSelection` refuse to write its own caret, which fails a test nowhere near
// here — so this suite hands the document back the way it found it.
afterEach(() => {
  document.getSelection()?.removeAllRanges();
});

/**
 * A painted paragraph in the painter's own child order.
 *
 * `paintFragment` appends shading, then the marker, then tab leaders, then the lines, and
 * finally the border rules — so the LAST child of a fragment is furniture, not the last
 * line, and the child index a browser reports is an index into that mixture.
 */
function paintedListParagraph(paragraphId: string): HTMLElement {
  const root = document.createElement('div');
  const fragment = document.createElement('div');
  fragment.className = 'docx-paragraph-fragment';
  fragment.dataset.paragraphId = paragraphId;
  fragment.dataset.fragmentIndex = '0';

  const shading = document.createElement('div');
  shading.className = 'docx-paragraph-shading';

  const marker = document.createElement('span');
  marker.className = 'docx-list-marker';
  marker.dataset.docxMarker = '';
  const markerGlyph = document.createElement('span');
  markerGlyph.textContent = '1.';
  marker.append(markerGlyph);

  const leader = document.createElement('div');
  leader.className = 'docx-tab-leader';
  leader.dataset.docxTabLeader = '';
  const leaderGlyphs = document.createElement('span');
  leaderGlyphs.textContent = '.'.repeat(12);
  leader.append(leaderGlyphs);

  // Two lines, so an endpoint that indexes the SECOND one has an offset of its own rather
  // than one that happens to coincide with the paragraph start.
  const lines = [
    { id: 'line-1', text: 'alpha ', start: 0 },
    { id: 'line-2', text: 'beta', start: 6 },
  ].map((source) => {
    const line = document.createElement('div');
    line.className = 'docx-line';
    line.dataset.lineId = source.id;
    line.dataset.paragraphId = paragraphId;
    const element = document.createElement('span');
    element.className = 'layout-run';
    element.dataset.paragraphId = paragraphId;
    element.dataset.start = String(source.start);
    element.dataset.end = String(source.start + source.text.length);
    element.textContent = source.text;
    line.append(element);
    return line;
  });

  const border = document.createElement('div');
  border.className = 'docx-paragraph-border docx-paragraph-border-bottom';

  fragment.append(shading, marker, leader, ...lines, border);
  root.append(fragment);
  return root;
}

describe('painted furniture never contributes a model offset', () => {
  test('an endpoint past the last child resolves to the end of the TEXT, not to furniture', () => {
    // The last child of a fragment is a border rule. Reading the container's own identity
    // there answered "offset 0 of the paragraph", so dragging past the end of a bordered
    // paragraph selected backwards to its start.
    const root = paintedListParagraph('p1');
    const fragment = root.querySelector('.docx-paragraph-fragment')!;
    expect(positionFromDomPoint(fragment, fragment.childNodes.length, root)).toEqual({
      paragraphId: 'p1',
      offset: 10,
    });
  });

  test('an endpoint at a line index resolves to that line, not to the paragraph start', () => {
    const root = paintedListParagraph('p1');
    const fragment = root.querySelector('.docx-paragraph-fragment')!;
    const second = root.querySelector('[data-line-id="line-2"]')!;
    const index = [...fragment.childNodes].indexOf(second);
    expect(positionFromDomPoint(fragment, index, root)).toEqual({
      paragraphId: 'p1',
      offset: 6,
    });
  });

  test('an endpoint inside a TAB LEADER is refused', () => {
    // The leader repeats a glyph per pixel of the reserved advance. Resolving it through
    // the fragment would answer "offset 0" for a click in the middle of a paragraph.
    const root = paintedListParagraph('p1');
    const leader = root.querySelector('[data-docx-tab-leader]')!;
    expect(positionFromDomPoint(leader.firstChild!.firstChild!, 4, root)).toBeNull();
    expect(positionFromDomPoint(leader, 0, root)).toBeNull();
  });

  test('an endpoint on a BORDER RULE is refused', () => {
    const root = paintedListParagraph('p1');
    const border = root.querySelector('.docx-paragraph-border')!;
    expect(positionFromDomPoint(border, 0, root)).toBeNull();
  });

  test('an endpoint on a SHADING BAND is refused', () => {
    const root = paintedListParagraph('p1');
    const shading = root.querySelector('.docx-paragraph-shading')!;
    expect(positionFromDomPoint(shading, 0, root)).toBeNull();
  });

  test('an endpoint inside a LIST MARKER resolves to the start of the paragraph it numbers', () => {
    // The marker paints at the paragraph's own start, inside the hanging indent, so that is
    // the one offset it can honestly answer. Returning nothing instead stranded the whole
    // selection, which is what let a command run on the previous range.
    const root = paintedListParagraph('p1');
    const marker = root.querySelector('[data-docx-marker]')!;
    expect(positionFromDomPoint(marker.firstChild!.firstChild!, 1, root)).toEqual({
      paragraphId: 'p1',
      offset: 0,
    });
  });

  test("the engine's own caret is refused: it belongs to no paragraph", () => {
    // The painted caret carries the same marker attribute but hangs off the page content
    // box, so there is no owning paragraph to resolve it through.
    const root = document.createElement('div');
    const content = document.createElement('div');
    content.className = 'docx-page-content';
    const caret = document.createElement('div');
    caret.dataset.docxCaret = '';
    caret.dataset.docxMarker = '';
    content.append(caret);
    root.append(content);
    expect(positionFromDomPoint(caret, 0, root)).toBeNull();
  });

  test('the paragraph text read back from the DOM excludes every piece of furniture', () => {
    // The composition readback diffs this against the model; a marker glyph or a leader's
    // dots leaking in would commit them into the document as real characters.
    const root = paintedListParagraph('p1');
    expect(paintedTextOf(root, 'p1', 'alpha beta')).toBe('alpha beta');
  });
});

/**
 * A paragraph holding a FIELD: `a potential [Scope of the discussions] (the `, where the field
 * is one model offset and twenty-four painted glyphs.
 */
function paintedFieldParagraph(): HTMLElement {
  const root = document.createElement('div');
  const line = document.createElement('div');
  line.className = 'docx-line';
  const add = (text: string, start: number, end: number, projected = false): void => {
    const span = document.createElement('span');
    span.dataset.paragraphId = 'p1';
    span.dataset.start = String(start);
    span.dataset.end = String(end);
    if (projected) {
      span.dataset.docxField = '';
      span.setAttribute('contenteditable', 'false');
    }
    span.textContent = text;
    line.append(span);
  };
  add('a potential ', 0, 12);
  add('Scope of the discussions', 12, 13, true);
  add(' (the ', 13, 19);
  root.append(line);
  return root;
}

const FIELD_MODEL_TEXT = 'a potential ￼ (the ';

describe('the readback over a paragraph containing a field', () => {
  test('reports the model text, so an untouched field looks untouched', () => {
    // Joining the PAINTED text made the readback see 23 characters the model does not have,
    // and the diff explained the difference the only way it could: delete the field, insert
    // its own rendering as literal characters. One composition anywhere in the paragraph
    // destroyed the field, permanently and silently.
    const root = paintedFieldParagraph();
    expect(paintedTextOf(root, 'p1', FIELD_MODEL_TEXT)).toBe(FIELD_MODEL_TEXT);
    expect(paragraphReplacePlan('p1', FIELD_MODEL_TEXT, FIELD_MODEL_TEXT)).toBeNull();
  });

  test('a real edit elsewhere in the paragraph is still recovered', () => {
    // The whole point of this path: text the browser wrote that the surface could not
    // intercept. Keying the field off "the lengths disagree" would have swallowed this,
    // because a browser edit is a length disagreement too.
    const root = paintedFieldParagraph();
    root.querySelector('span')!.textContent = 'a potentialxy ';
    const painted = paintedTextOf(root, 'p1', FIELD_MODEL_TEXT)!;
    expect(painted).toBe('a potentialxy ￼ (the ');
    expect(paragraphReplacePlan('p1', FIELD_MODEL_TEXT, painted)).toEqual({
      ops: [{ op: 'insertText', paragraphId: 'p1', offset: 11, text: 'xy' }],
      caret: 13,
    });
  });
});

describe('a model position lands on real text', () => {
  test('a run wearing BOTH decorations resolves to the text node under its layers', () => {
    // `mountRunText` nests an underline span and a strike span when both apply, so the run
    // element's first child is an ELEMENT. Using it as the selection node turned a character
    // offset into a child index, and the browser then rejected the whole write — no caret,
    // no highlight, anywhere inside a run that was underlined and struck.
    const root = document.createElement('div');
    const line = document.createElement('div');
    line.className = 'docx-line';
    line.dataset.lineId = 'line-1';
    line.dataset.paragraphId = 'p1';
    const run = document.createElement('span');
    run.dataset.paragraphId = 'p1';
    run.dataset.start = '0';
    run.dataset.end = '9';
    const underline = document.createElement('span');
    underline.dataset.docxDeco = 'underline';
    const strike = document.createElement('span');
    strike.dataset.docxDeco = 'strike';
    strike.textContent = 'decorated';
    underline.append(strike);
    run.append(underline);
    line.append(run);
    root.append(line);
    document.body.append(root);

    const applied = applySelectionToDom(
      root,
      { anchor: { paragraphId: 'p1', offset: 2 }, head: { paragraphId: 'p1', offset: 6 } },
      getSelection()
    );
    expect(applied).toBe(true);
    const selection = getSelection()!;
    expect(selection.anchorNode).toBe(strike.firstChild);
    expect(selection.anchorOffset).toBe(2);
    expect(selection.focusOffset).toBe(6);
    root.remove();
  });
});

// --- the surface, over a real package -------------------------------------------------

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const NUMREL = `${R}/numbering`;

const NUMBERING =
  `<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0">` +
  '<w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/>' +
  '<w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>' +
  '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>';

const listItem = (text: string) =>
  '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>' +
  `<w:r><w:t>${text}</w:t></w:r></w:p>`;

/** A numbered list, optionally with a header part so its furniture is painted too. */
function docx(body: string, header?: string): Uint8Array {
  const headerRel = header
    ? `<Relationship Id="rId10" Type="${R}/header" Target="header1.xml"/>`
    : '';
  const headerOverride = header
    ? '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>'
    : '';
  const sectPr = header
    ? '<w:sectPr><w:headerReference w:type="default" r:id="rId10"/></w:sectPr>'
    : '';
  const entries: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>' +
        headerOverride +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId9" Type="${NUMREL}" Target="numbering.xml"/>${headerRel}</Relationships>`
    ),
    'word/numbering.xml': strToU8(NUMBERING),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}${sectPr}</w:body></w:document>`
    ),
  };
  if (header) {
    entries['word/header1.xml'] = strToU8(`<w:hdr xmlns:w="${W}">${header}</w:hdr>`);
  }
  return zipSync(entries);
}

function mount(bytes: Uint8Array): { surface: PaginatedSurface; container: HTMLElement } {
  const container = document.createElement('div');
  document.body.append(container);
  const opened = mountPaginatedSurface(container, bytes, { scale: 1 });
  if (!opened.ok) throw new Error(opened.reason);
  return { surface: opened.surface, container };
}

/** The deepest text node under an element, which is where painted glyphs live. */
function textNodeIn(element: Element): Node {
  let node: Node = element;
  while (node.firstChild) node = node.firstChild;
  return node;
}

/**
 * Make a browser selection and tell the surface, the way a real gesture would.
 *
 * The programmatic write the surface does on every state change is suppressed for a
 * microtask, so the model selection has to settle before the DOM selection is replaced.
 */
async function gesture(anchor: [Node, number], head: [Node, number]): Promise<void> {
  await Promise.resolve();
  const selection = document.getSelection()!;
  selection.removeAllRanges();
  const range = document.createRange();
  range.setStart(anchor[0], anchor[1]);
  range.setEnd(head[0], head[1]);
  selection.addRange(range);
  document.dispatchEvent(new Event('selectionchange'));
}

describe('an unmappable gesture never leaves the model on the previous range', () => {
  test('a word selection anchored in the list marker replaces the earlier selection', async () => {
    // NOT the reported gesture. Chrome anchors a double-click on the first word of a list
    // item in the run's own text node, never in the marker — that was checked against a real
    // browser. This covers the endpoint SHAPE, which a shift-click or a drag beginning on the
    // bullet still produces: an endpoint that maps to nothing used to leave the model on
    // whatever it held before, and the next command ran on that.
    const { surface, container } = mount(docx(listItem('alpha beta')));
    try {
      const id = surface.session.paragraphIds()[0]!;
      surface.setSelection({
        anchor: { paragraphId: id, offset: 6 },
        head: { paragraphId: id, offset: 10 },
      });
      const marker = container.querySelector('[data-docx-marker]')!;
      const run = container.querySelector('[data-paragraph-id][data-start]')!;
      await gesture([textNodeIn(marker), 0], [textNodeIn(run), 5]);

      expect(surface.state().selection).toEqual({
        anchor: { paragraphId: id, offset: 0 },
        head: { paragraphId: id, offset: 5 },
      });
    } finally {
      surface.destroy();
      container.remove();
    }
  });

  test('a selection made in header furniture collapses the model rather than stranding it', async () => {
    // Header text is painted from ANOTHER part, which the session cannot address, so the
    // endpoints are refused by design. Keeping the body range alive behind them is what made
    // the next command format text the user had stopped looking at.
    const { surface, container } = mount(
      docx(listItem('alpha beta'), '<w:p><w:r><w:t>letterhead</w:t></w:r></w:p>')
    );
    try {
      const id = surface.session.paragraphIds()[0]!;
      surface.setSelection({
        anchor: { paragraphId: id, offset: 0 },
        head: { paragraphId: id, offset: 10 },
      });
      const headerRun = container.querySelector('[data-docx-hf] [data-start]')!;
      await gesture([textNodeIn(headerRun), 0], [textNodeIn(headerRun), 6]);

      const after = surface.state().selection;
      expect(after.anchor).toEqual(after.head);
    } finally {
      surface.destroy();
      container.remove();
    }
  });
});

describe('a render never discards a gesture the model has not adopted yet', () => {
  const long = `<w:p><w:r><w:t>${'word '.repeat(4000)}</w:t></w:r></w:p>`;

  /** The surface inside a scroll container, with the viewport happy-dom cannot measure. */
  function mountScrolled(): {
    surface: PaginatedSurface;
    host: HTMLElement;
    scroller: HTMLElement;
  } {
    const scroller = document.createElement('div');
    scroller.className = 'docx-editor__scroll-container';
    const host = document.createElement('div');
    scroller.append(host);
    document.body.append(scroller);
    Object.defineProperty(scroller, 'clientHeight', { value: 800, configurable: true });
    const opened = mountPaginatedSurface(host, docx(long), { scale: 1 });
    if (!opened.ok) throw new Error(opened.reason);
    return { surface: opened.surface, host, scroller };
  }

  test('a repaint adopts the live browser selection instead of writing the model over it', async () => {
    // THE WINDOW THAT LOSES A DOUBLE-CLICK.
    //
    // `selectionchange` is QUEUED, not dispatched from the gesture, so between the browser
    // making a selection and the surface hearing about it there is a real gap — and anything
    // that repaints inside it (a scroll, a commit from another editor) used to write the
    // model's OLDER selection straight back over the user's. The word went away, and the
    // model never learned it had ever been selected.
    const { surface, host, scroller } = mountScrolled();
    try {
      const id = surface.session.paragraphIds()[0]!;
      surface.setSelection({
        anchor: { paragraphId: id, offset: 0 },
        head: { paragraphId: id, offset: 0 },
      });

      // The gesture: a word selected on the first page, with its event still queued.
      const run = host.querySelector('.docx-page[data-page-index="0"] [data-start]')!;
      const text = textNodeIn(run);
      const selection = document.getSelection()!;
      selection.removeAllRanges();
      const range = document.createRange();
      range.setStart(text, 0);
      range.setEnd(text, 4);
      selection.addRange(range);

      // A scroll lands in the gap. It is not a model change, so nothing here may move the
      // selection — but it repaints, and the repaint is what used to overwrite it.
      scroller.scrollTop = surface.layout().pages[1]!.box.y;
      scroller.dispatchEvent(new Event('scroll'));
      await new Promise((resolve) => setTimeout(resolve, 50));

      const after = surface.state().selection;
      expect(after.anchor.offset).toBe(0);
      expect(after.head.offset).toBe(4);
      expect(document.getSelection()!.isCollapsed).toBe(false);
    } finally {
      surface.destroy();
      scroller.remove();
    }
  });

  test('a repaint still carries out a model move the user has not seen yet', async () => {
    // The mirror case, and why this cannot simply skip the write: a commit installs its own
    // post-edit caret, and the DOM selection left over from before the edit addresses offsets
    // that no longer mean the same thing. There the model is the newer of the two.
    const { surface, host, scroller } = mountScrolled();
    try {
      const id = surface.session.paragraphIds()[0]!;
      surface.setSelection({
        anchor: { paragraphId: id, offset: 0 },
        head: { paragraphId: id, offset: 0 },
      });
      const run = host.querySelector('.docx-page[data-page-index="0"] [data-start]')!;
      const text = textNodeIn(run);
      const selection = document.getSelection()!;
      selection.removeAllRanges();
      const range = document.createRange();
      range.setStart(text, 0);
      range.setEnd(text, 4);
      selection.addRange(range);

      surface.type('X');
      expect(surface.session.bodyText().startsWith('X')).toBe(true);
      // The caret the commit installed, not the stale range that was in the DOM.
      const after = surface.state().selection;
      expect(after.anchor).toEqual(after.head);
      expect(after.head.offset).toBe(1);
    } finally {
      surface.destroy();
      scroller.remove();
    }
  });

  test('an undo with nothing to undo does not disarm the next repaint', async () => {
    // THE FLAG THAT STAYS RAISED.
    //
    // The guard that lets a model move win over the DOM is raised by `restoreSelection` and
    // taken down by the render that carries it out — but `undo` on an EMPTY history commits
    // nothing, so there is no render, and the flag stayed up. Ctrl+Z as the first thing a
    // user presses therefore disarmed the NEXT repaint, whenever it came, and that repaint
    // wrote the caret over the selection the user had made since.
    const { surface, host, scroller } = mountScrolled();
    try {
      const id = surface.session.paragraphIds()[0]!;
      expect(surface.session.canUndo()).toBe(false);
      surface.undo();
      await Promise.resolve();

      surface.setSelection({
        anchor: { paragraphId: id, offset: 0 },
        head: { paragraphId: id, offset: 0 },
      });
      // The gesture, made inside the window where the surface treats `selectionchange` as
      // the echo of its own write — which is what a queued event looks like from here.
      const run = host.querySelector('.docx-page[data-page-index="0"] [data-start]')!;
      const text = textNodeIn(run);
      const selection = document.getSelection()!;
      selection.removeAllRanges();
      const range = document.createRange();
      range.setStart(text, 0);
      range.setEnd(text, 4);
      selection.addRange(range);
      expect(surface.state().selection.head.offset).toBe(0);
      await Promise.resolve();

      scroller.scrollTop = surface.layout().pages[1]!.box.y;
      scroller.dispatchEvent(new Event('scroll'));
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(surface.state().selection.head.offset).toBe(4);
    } finally {
      surface.destroy();
      scroller.remove();
    }
  });
});

describe('the unmappable backstop only fires when nothing maps', () => {
  test('an ordinary body gesture keeps its whole range', async () => {
    // Collapsing is the safe answer to a gesture the model cannot address. It must never be
    // the answer to one it can — that would destroy exactly the selection this is protecting.
    const { surface, container } = mount(docx(listItem('alpha beta')));
    try {
      const id = surface.session.paragraphIds()[0]!;
      surface.setSelection({
        anchor: { paragraphId: id, offset: 0 },
        head: { paragraphId: id, offset: 0 },
      });
      const run = container.querySelector<HTMLElement>('[data-paragraph-id][data-start]')!;
      const start = Number(run.dataset.start);
      const text = textNodeIn(run);
      await gesture([text, 1], [text, 4]);

      expect(surface.state().selection).toEqual({
        anchor: { paragraphId: id, offset: start + 1 },
        head: { paragraphId: id, offset: start + 4 },
      });
    } finally {
      surface.destroy();
      container.remove();
    }
  });
});

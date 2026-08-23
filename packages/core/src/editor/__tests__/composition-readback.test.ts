// WHAT AN IME WROTE INTO THE PAINTED DOM, READ BACK IN THE MODEL'S OFFSET SPACE.
//
// `beforeinput` for `insertCompositionText` is not cancelable, so composed text unavoidably
// lands in the painted DOM and the readback at `compositionend` is the ONLY route by which it
// reaches the tree. Everything that route cannot see is an edit the user made and the document
// never got.
//
// Two ways it could not see one:
//
//   - The text is not inside a `[data-start]` span. An empty paragraph paints a line holding
//     nothing but a `<br>`, so the browser is handed the LINE as the selection node and
//     composes a bare text node into it. Chinese could not be typed at the start of an empty
//     paragraph at all (#190).
//   - The paragraph is painted MORE THAN ONCE. A shared header or footer repaints the same
//     paragraph ids on every page, so a document-wide scan read a three-page header back as
//     three concatenated copies of itself and then wrote the extra two into the part.
//
// The other half of the contract is what must NEVER reach the model: a list marker's bullet,
// a tab leader's dots, the revision pilcrow, and a field's painted result are all painted
// inside the paragraph and are not characters the document has.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NUMREL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering';

/** Two Chinese characters, the input the report was written against. */
const COMPOSED = '中文';

const NUMBERING =
  `<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0">` +
  '<w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/>' +
  '<w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>' +
  '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>';

const LIST_ITEM =
  '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr></w:p>';

const CELL =
  '<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="dxa"/></w:tblPr>' +
  '<w:tblGrid><w:gridCol w:w="5000"/></w:tblGrid>' +
  '<w:tr><w:tc><w:tcPr><w:tcW w:w="5000" w:type="dxa"/></w:tcPr><w:p/></w:tc></w:tr></w:tbl>';

const p = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const PAGE_BREAK = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';

function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId9" Type="${NUMREL}" Target="numbering.xml"/></Relationships>`
    ),
    'word/numbering.xml': strToU8(NUMBERING),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

function headerDocx(header: string, body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId10" Type="${R}/header" Target="header1.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}` +
        '<w:sectPr><w:headerReference w:type="default" r:id="rId10"/></w:sectPr></w:body></w:document>'
    ),
    'word/header1.xml': strToU8(`<w:hdr xmlns:w="${W}">${header}</w:hdr>`),
  });
}

function withSurface(
  bytes: Uint8Array,
  run: (surface: PaginatedSurface, container: HTMLElement) => void
): void {
  const container = document.createElement('div');
  document.body.append(container);
  const opened = mountPaginatedSurface(container, bytes, { scale: 1 });
  if (!opened.ok) throw new Error(opened.reason);
  try {
    run(opened.surface, container);
  } finally {
    opened.surface.destroy();
    container.remove();
    document.getSelection()?.removeAllRanges();
  }
}

function caretAt(surface: PaginatedSurface, paragraphId: string, offset: number): void {
  surface.setSelection({
    anchor: { paragraphId, offset },
    head: { paragraphId, offset },
  });
}

/**
 * What the browser does for a composition the surface could not intercept: it writes the
 * painted DOM itself, and only then says it is finished.
 *
 * `write` receives the painted copy the caret is in — the ACTIVE header/footer when one is
 * open, which is the one copy an IME can reach.
 */
function compose(container: HTMLElement, write: (scope: Element) => void): void {
  const pages = container.querySelector('.docx-pages')!;
  pages.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
  write(container.querySelector('[data-docx-hf-active]') ?? pages);
  pages.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
}

/** The painted line of a paragraph — the node an empty paragraph hands the browser. */
function lineOf(scope: Element, paragraphId: string): HTMLElement {
  for (const element of scope.querySelectorAll('[data-paragraph-id][data-line-id]')) {
    if ((element as HTMLElement).dataset.paragraphId === paragraphId) return element as HTMLElement;
  }
  throw new Error(`no painted line for ${paragraphId}`);
}

/** The IME composes a bare text node at the head of the line, which is where the caret was. */
function composeIntoLine(scope: Element, paragraphId: string, text: string): void {
  const line = lineOf(scope, paragraphId);
  line.insertBefore(document.createTextNode(text), line.firstChild);
}

describe('#190 composition at offset 0 of an empty paragraph', () => {
  test('the composed text is committed', () => {
    withSurface(docx('<w:p/>'), (surface, container) => {
      const id = surface.session.paragraphIds()[0]!;
      caretAt(surface, id, 0);
      compose(container, (scope) => composeIntoLine(scope, id, COMPOSED));
      expect(surface.state().lastRejection).toBeNull();
      expect(surface.session.bodyText()).toBe(COMPOSED);
      // The caret lands after the composed text, not back at the paragraph start.
      expect(surface.state().selection.head).toEqual({ paragraphId: id, offset: COMPOSED.length });
    });
  });

  test('an empty paragraph AFTER one with text still composes into itself', () => {
    // The readback addresses one paragraph, but a document-wide scan for its spans found the
    // neighbours' too. The empty one has none, which is exactly the case that used to fall
    // through to "nothing painted, nothing to commit".
    withSurface(docx(`${p('alpha')}<w:p/>${p('beta')}`), (surface, container) => {
      const id = surface.session.paragraphIds()[1]!;
      caretAt(surface, id, 0);
      compose(container, (scope) => composeIntoLine(scope, id, COMPOSED));
      expect(surface.session.bodyText()).toBe(`alpha\n${COMPOSED}\nbeta`);
    });
  });

  test('an empty paragraph in a TABLE CELL composes like any other', () => {
    withSurface(docx(CELL), (surface, container) => {
      const id = surface.session.paragraphIds()[0]!;
      caretAt(surface, id, 0);
      compose(container, (scope) => composeIntoLine(scope, id, COMPOSED));
      expect(surface.state().lastRejection).toBeNull();
      expect(surface.session.bodyText()).toBe(COMPOSED);
    });
  });

  test('a composition that writes nothing commits nothing', () => {
    withSurface(docx('<w:p/>'), (surface) => {
      const id = surface.session.paragraphIds()[0]!;
      caretAt(surface, id, 0);
      const container = document.querySelector('.docx-pages')!;
      container.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      container.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
      expect(surface.session.bodyText()).toBe('');
    });
  });
});

describe('painted furniture is never composed into the document', () => {
  test('an empty LIST item commits the composed text without its marker', () => {
    // The marker is painted inside the paragraph fragment and carries the numbering glyph.
    // Reading the fragment's text content wholesale would have written "1." into the list
    // item as real characters — and the next repaint would number it "2." beside them.
    withSurface(docx(LIST_ITEM), (surface, container) => {
      const id = surface.session.paragraphIds()[0]!;
      caretAt(surface, id, 0);
      const marker = container.querySelector('.docx-list-marker');
      expect(marker?.textContent).toBe('1.');
      compose(container, (scope) => composeIntoLine(scope, id, COMPOSED));
      expect(surface.session.bodyText()).toBe(COMPOSED);
    });
  });
});

describe('a paragraph painted on more than one page', () => {
  test('a shared header reads back ONE copy, not one per page', () => {
    withSurface(
      headerDocx(p('HDR'), p('one') + PAGE_BREAK + p('two') + PAGE_BREAK + p('three')),
      (surface, container) => {
        expect(container.querySelectorAll('.docx-page').length).toBe(3);
        expect(surface.enterHeaderFooter({ rId: 'rId10' })).toBe(true);
        const scope = { kind: 'headerFooter', rId: 'rId10' } as const;
        const id = surface.session.paragraphIdsIn(scope)[0]!;
        caretAt(surface, id, 3);
        compose(container, (active) => {
          const span = [...active.querySelectorAll('[data-paragraph-id][data-start]')].find(
            (element) => (element as HTMLElement).dataset.paragraphId === id
          ) as HTMLElement;
          span.textContent = `HDR${COMPOSED}`;
        });
        expect(surface.state().lastRejection).toBeNull();
        expect(surface.session.storyText(scope)).toBe(`HDR${COMPOSED}`);
      }
    );
  });

  test('an EMPTY shared header paragraph composes into itself once', () => {
    withSurface(headerDocx('<w:p/>', p('one') + PAGE_BREAK + p('two')), (surface, container) => {
      expect(surface.enterHeaderFooter({ rId: 'rId10' })).toBe(true);
      const scope = { kind: 'headerFooter', rId: 'rId10' } as const;
      const id = surface.session.paragraphIdsIn(scope)[0]!;
      caretAt(surface, id, 0);
      compose(container, (active) => composeIntoLine(active, id, COMPOSED));
      expect(surface.state().lastRejection).toBeNull();
      expect(surface.session.storyText(scope)).toBe(COMPOSED);
    });
  });
});

describe('the ordinary case still holds', () => {
  test('composing inside an existing run commits the difference', () => {
    withSurface(docx(p('abc')), (surface, container) => {
      const id = surface.session.paragraphIds()[0]!;
      caretAt(surface, id, 3);
      compose(container, (scope) => {
        const span = [...scope.querySelectorAll('[data-paragraph-id][data-start]')].find(
          (element) => (element as HTMLElement).dataset.paragraphId === id
        ) as HTMLElement;
        span.textContent = `abc${COMPOSED}`;
      });
      expect(surface.session.bodyText()).toBe(`abc${COMPOSED}`);
    });
  });
});

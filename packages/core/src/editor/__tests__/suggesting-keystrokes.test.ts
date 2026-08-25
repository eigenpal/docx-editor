// Typing in SUGGESTING mode, through the surface rather than the store.
//
// The store's own markup rules live in `store/__tests__/tracked-edits.test.ts`. What is
// pinned here is the keystroke sequence a reviewer actually performs: Enter opens a
// paragraph, and the next character has to land in it. Enter leaves a paragraph carrying
// `w:pPr` and nothing else — the shape a tracked insertion has to be able to write into —
// so a rule that only held for a paragraph with runs in it looked like a dead keyboard.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';
import { serializeOoxmlPart, type OoxmlNode } from '@docx-editor.dev/core/store';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const NUM = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering';

const NUMBERING =
  `<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0">` +
  '<w:start w:val="1"/><w:numFmt w:val="upperRoman"/><w:lvlText w:val="%1."/>' +
  '<w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>' +
  '</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>';

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
      `<Relationships xmlns="${REL}"><Relationship Id="rId9" Type="${NUM}" Target="numbering.xml"/></Relationships>`
    ),
    'word/numbering.xml': strToU8(NUMBERING),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

const listItem = (text: string) =>
  '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>' +
  `<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

const styledParagraph = (text: string) =>
  `<w:p><w:pPr><w:ind w:left="720"/></w:pPr><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

const plainParagraph = (text: string) =>
  `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

function withSurface(body: string, run: (surface: PaginatedSurface) => void): void {
  const container = document.createElement('div');
  document.body.append(container);
  const opened = mountPaginatedSurface(container, docx(body), { author: 'Ada Lovelace' });
  if (!opened.ok) throw new Error(opened.reason);
  try {
    opened.surface.setEditingMode('suggest');
    run(opened.surface);
  } finally {
    opened.surface.destroy();
    container.remove();
  }
}

/** Every paragraph's text, in document order. */
function paragraphTexts(surface: PaginatedSurface): string[] {
  const out: string[] = [];
  const collect = (node: OoxmlNode, into: string[]): void => {
    if (node.kind === 'textValue') {
      into.push(node.value);
      return;
    }
    for (const child of node.children) collect(child, into);
  };
  const walk = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.kind === 'paragraph') {
      const parts: string[] = [];
      collect(node, parts);
      out.push(parts.join(''));
      return;
    }
    for (const child of node.children) walk(child);
  };
  walk(surface.session.part().root);
  return out;
}

function caretTo(surface: PaginatedSurface, index: number, offset: number): void {
  const paragraphId = surface.session.paragraphIds()[index]!;
  surface.setSelection({
    anchor: { paragraphId, offset },
    head: { paragraphId, offset },
  });
}

function selectIn(surface: PaginatedSurface, index: number, start: number, end: number): void {
  const paragraphId = surface.session.paragraphIds()[index]!;
  surface.setSelection({
    anchor: { paragraphId, offset: start },
    head: { paragraphId, offset: end },
  });
}

function selectAcross(
  surface: PaginatedSurface,
  fromIndex: number,
  fromOffset: number,
  toIndex: number,
  toOffset: number
): void {
  const ids = surface.session.paragraphIds();
  surface.setSelection({
    anchor: { paragraphId: ids[fromIndex]!, offset: fromOffset },
    head: { paragraphId: ids[toIndex]!, offset: toOffset },
  });
}

/** Type `text` one character at a time, the way a keyboard delivers it. */
function typeEach(surface: PaginatedSurface, text: string): void {
  for (const character of text) surface.type(character);
}

describe('Enter then type, in suggesting mode', () => {
  test('the character lands in the list item Enter just opened', () => {
    withSurface(listItem('Introduction') + listItem('Analysis'), (surface) => {
      caretTo(surface, 0, 'Introduction'.length);
      surface.splitParagraph();
      surface.insertPlainText('Findings');
      expect(surface.state().lastRejection).toBeNull();
      expect(paragraphTexts(surface)).toEqual(['Introduction', 'Findings', 'Analysis']);
    });
  });

  test('and in a plain paragraph that only carries an indent', () => {
    withSurface(styledParagraph('first'), (surface) => {
      caretTo(surface, 0, 'first'.length);
      surface.splitParagraph();
      surface.insertPlainText('second');
      expect(surface.state().lastRejection).toBeNull();
      expect(paragraphTexts(surface)).toEqual(['first', 'second']);
    });
  });

  test('the typed run is a proposal, and the properties stay ahead of it', () => {
    withSurface(listItem('Introduction'), (surface) => {
      caretTo(surface, 0, 'Introduction'.length);
      surface.splitParagraph();
      surface.insertPlainText('Findings');
      const xml = serializeOoxmlPart(surface.session.part());
      expect(xml).toMatch(/<w:ins[^>]*w:author="Ada Lovelace"[^>]*>/);
      // `w:pPr` first (§17.3.1.26). The insertion landing ahead of it is markup the
      // paragraph invariant refuses, which is how the keystroke came to be dropped.
      expect(xml).toMatch(/<\/w:pPr><w:ins[^>]*><w:r><w:t[^>]*>Findings<\/w:t><\/w:r><\/w:ins>/);
    });
  });
});

// TYPING OVER YOUR OWN SUGGESTION.
//
// A tracked deletion does one of two things, and the replacement offset differs for each.
// Somebody else's words are STRUCK: they stay, and the replacement goes after them. Your own
// pending insertion is RETRACTED: the characters leave the paragraph, and aiming past them
// aims past the end of it — which the store refuses, taking the whole transaction with it.
// So every keystroke over your own suggestion did nothing, and the selection stayed.
describe('typing over a pending suggestion', () => {
  test('replaces your own insertion instead of being refused', () => {
    withSurface(listItem('Introduction') + listItem('Analysis'), (surface) => {
      caretTo(surface, 0, 'Introduction'.length);
      surface.splitParagraph();
      typeEach(surface, 'sda');
      selectIn(surface, 1, 0, 3);
      typeEach(surface, 'Hello');
      expect(surface.state().lastRejection).toBeNull();
      expect(paragraphTexts(surface)).toEqual(['Introduction', 'Hello', 'Analysis']);
      // The caret follows the typing, so the NEXT character lands after it rather than in
      // front of what was already typed.
      expect(surface.state().selection.head.offset).toBe('Hello'.length);
    });
  });

  test('keeps the struck half of a mixed range and lands after it', () => {
    withSurface(listItem('Analysis'), (surface) => {
      caretTo(surface, 0, 0);
      typeEach(surface, 'New ');
      // "New " is this author's own insertion; "Ana" is the file's own text.
      selectIn(surface, 0, 0, 'New Ana'.length);
      surface.type('X');
      expect(surface.state().lastRejection).toBeNull();
      // The retracted half is gone, the struck half stays, and the replacement sits after it.
      expect(paragraphTexts(surface)).toEqual(['AnaXlysis']);
      const xml = serializeOoxmlPart(surface.session.part());
      expect(xml).toMatch(/<w:del[^>]*><w:r><w:delText[^>]*>Ana<\/w:delText><\/w:r><\/w:del>/);
      expect(xml).toMatch(/<w:ins[^>]*><w:r><w:t[^>]*>X<\/w:t><\/w:r><\/w:ins>/);
      expect(xml).not.toMatch(/New/);
    });
  });
});

// TAKING A BREAK BACK IS NOT A SECOND PROPOSAL.
//
// A join is addressed by the SECOND paragraph, because the mark between two paragraphs
// belongs to the first — so Backspace at the start of a paragraph reaches the mark through
// `proposeParagraphMerge`, which never asked whether the mark was this author's own. Enter
// then Backspace therefore wrote a `w:del` on top of the `w:ins` from a second earlier: two
// cards in the rail for a decision nobody made, an empty paragraph left standing, and a mark
// whose Reject makes permanent the very break the user had just taken back. Word retracts it.
describe('Enter then Backspace, in suggesting mode', () => {
  test('the paragraph break goes away instead of stacking a deletion on it', () => {
    withSurface(listItem('Introduction') + listItem('Analysis'), (surface) => {
      caretTo(surface, 0, 'Introduction'.length);
      surface.splitParagraph();
      expect(surface.session.paragraphIds()).toHaveLength(3);

      surface.deleteBackward();
      expect(surface.state().lastRejection).toBeNull();
      expect(surface.session.paragraphIds()).toHaveLength(2);
      expect(paragraphTexts(surface)).toEqual(['Introduction', 'Analysis']);

      // Nothing is left to review: the proposal and its retraction cancel out.
      const xml = serializeOoxmlPart(surface.session.part());
      expect(xml).not.toMatch(/<w:ins/);
      expect(xml).not.toMatch(/<w:del/);
    });
  });

  test('somebody ELSE’s proposed break is still proposed away, not joined', () => {
    // The rule is about YOUR OWN proposal. A break another reviewer proposed is theirs to
    // keep until someone decides on it, so Backspace over it stays a proposal.
    withSurface(
      '<w:p><w:pPr><w:rPr><w:ins w:id="7" w:author="Grace Hopper" w:date="2026-01-01T00:00:00Z"/></w:rPr></w:pPr>' +
        '<w:r><w:t>Introduction</w:t></w:r></w:p>' +
        listItem('Analysis'),
      (surface) => {
        caretTo(surface, 1, 0);
        surface.deleteBackward();
        expect(surface.state().lastRejection).toBeNull();
        expect(surface.session.paragraphIds()).toHaveLength(2);
        const xml = serializeOoxmlPart(surface.session.part());
        expect(xml).toMatch(/<w:ins[^>]*w:author="Grace Hopper"/);
        expect(xml).toMatch(/<w:del[^>]*w:author="Ada Lovelace"/);
      }
    );
  });
});

// REPLACING A SELECTION THAT SPANS PARAGRAPH MARKS.
//
// A suggesting-mode deletion keeps the characters it strikes, and the marks between the
// paragraphs become merge proposals — every paragraph survives. So the replacement belongs
// after the struck head of the LAST paragraph. Landing it at the range start instead put it
// on the front edge of the fresh `w:del`, where the store relocates it past the deletion;
// the caret math never heard about the relocation, so the caret came to rest INSIDE the
// struck words, and each next keystroke relocated to the same spot — BEFORE the one already
// typed. A typed replacement came out reversed, parked after the first struck paragraph.
describe('replacing a selection that spans paragraphs, in suggesting mode', () => {
  test('the replacement lands after the LAST struck paragraph, in typing order', () => {
    withSurface(
      plainParagraph('Alpha one') + plainParagraph('Beta two') + plainParagraph('Gamma three'),
      (surface) => {
        selectAcross(surface, 0, 0, 2, 'Gamma three'.length);
        typeEach(surface, 'New');
        expect(surface.state().lastRejection).toBeNull();
        expect(paragraphTexts(surface)).toEqual(['Alpha one', 'Beta two', 'Gamma threeNew']);
        const xml = serializeOoxmlPart(surface.session.part());
        // The struck original stays, and the replacement is ONE ordered insertion after it.
        expect(xml).toMatch(
          /<w:delText[^>]*>Gamma three<\/w:delText><\/w:r><\/w:del><w:ins[^>]*><w:r><w:t[^>]*>New<\/w:t>/
        );
        // The caret follows the typing, so the NEXT character extends the replacement
        // rather than landing in front of it.
        expect(surface.state().selection.head).toEqual({
          paragraphId: surface.session.paragraphIds()[2]!,
          offset: 'Gamma threeNew'.length,
        });
      }
    );
  });

  test('a paste over the selection lands in the same place', () => {
    withSurface(plainParagraph('Alpha one') + plainParagraph('Beta two'), (surface) => {
      selectAcross(surface, 0, 0, 1, 'Beta two'.length);
      surface.insertPlainText('Replacement');
      expect(surface.state().lastRejection).toBeNull();
      expect(paragraphTexts(surface)).toEqual(['Alpha one', 'Beta twoReplacement']);
      expect(surface.state().selection.head).toEqual({
        paragraphId: surface.session.paragraphIds()[1]!,
        offset: 'Beta twoReplacement'.length,
      });
    });
  });

  test('this author’s own insertion at the head of the last paragraph retracts', () => {
    withSurface(plainParagraph('Alpha') + plainParagraph('Beta'), (surface) => {
      caretTo(surface, 1, 0);
      typeEach(surface, 'XY');
      // The range covers "pha", the pending "XY" and the struck-to-be "Be": the struck
      // halves stay, the author's own insertion leaves, and the replacement sits after
      // what remains of the last paragraph's struck head.
      selectAcross(surface, 0, 2, 1, 4);
      surface.type('Z');
      expect(surface.state().lastRejection).toBeNull();
      expect(paragraphTexts(surface)).toEqual(['Alpha', 'BeZta']);
      const xml = serializeOoxmlPart(surface.session.part());
      expect(xml).not.toMatch(/XY/);
    });
  });

  test('typing with the caret resting INSIDE struck words lands past the deletion', () => {
    withSurface(plainParagraph('Alpha one'), (surface) => {
      selectIn(surface, 0, 0, 'Alpha'.length);
      surface.deleteBackward();
      caretTo(surface, 0, 2);
      typeEach(surface, 'ab');
      expect(surface.state().lastRejection).toBeNull();
      expect(paragraphTexts(surface)).toEqual(['Alphaab one']);
      expect(surface.state().selection.head.offset).toBe('Alphaab'.length);
    });
  });

  test('a MULTI-LINE paste splits inside the tracked insertion, not after it', () => {
    // `splitParagraphMany` is the op paste emits, and `distributeInline` used to send a
    // whole `w:ins` wrapper to the first piece — the lines stayed in one paragraph and the
    // minted tails came out empty.
    withSurface(plainParagraph('Alpha one') + plainParagraph('Beta two'), (surface) => {
      selectAcross(surface, 0, 0, 1, 'Beta two'.length);
      surface.insertPlainText('one\ntwo');
      expect(surface.state().lastRejection).toBeNull();
      expect(paragraphTexts(surface)).toEqual(['Alpha one', 'Beta twoone', 'two']);
      const xml = serializeOoxmlPart(surface.session.part());
      // Each piece keeps the same tracked-insertion attribution.
      expect(xml).toMatch(/<w:ins[^>]*><w:r><w:t[^>]*>one<\/w:t><\/w:r><\/w:ins>/);
      expect(xml).toMatch(/<w:ins[^>]*><w:r><w:t[^>]*>two<\/w:t><\/w:r><\/w:ins>/);
      expect(surface.state().selection.head.offset).toBe('two'.length);
    });
  });

  test('typing over your OWN pending Enter split merges and lands after the strike', () => {
    // The join that retracts this author's own paragraph mark REALLY joins, so the last
    // paragraph of the range leaves the tree — an insert naming it vetoed the whole
    // transaction and every keystroke did nothing.
    withSurface(plainParagraph('Alpha Beta'), (surface) => {
      caretTo(surface, 0, 'Alpha'.length);
      surface.splitParagraph();
      selectAcross(surface, 0, 2, 1, 3);
      typeEach(surface, 'X');
      expect(surface.state().lastRejection).toBeNull();
      expect(paragraphTexts(surface)).toEqual(['Alpha BeXta']);
      expect(surface.state().selection.head.offset).toBe('Alpha BeX'.length);
    });
  });

  test('a range that ENDS inside a pre-existing deletion lands past it, in order', () => {
    withSurface(plainParagraph('Alpha one'), (surface) => {
      selectIn(surface, 0, 0, 'Alpha'.length);
      surface.deleteBackward();
      selectIn(surface, 0, 1, 3);
      typeEach(surface, 'ab');
      expect(surface.state().lastRejection).toBeNull();
      expect(paragraphTexts(surface)).toEqual(['Alphaab one']);
      expect(surface.state().selection.head.offset).toBe('Alphaab'.length);
    });
  });

  test('Enter over a selection breaks AFTER the struck words', () => {
    withSurface(plainParagraph('Alpha Beta Gamma'), (surface) => {
      selectIn(surface, 0, 'Alpha '.length, 'Alpha Beta'.length);
      surface.splitParagraph();
      expect(surface.state().lastRejection).toBeNull();
      // The struck word stays with the paragraph it came from; the tail carries the rest.
      expect(paragraphTexts(surface)).toEqual(['Alpha Beta', ' Gamma']);
      expect(surface.state().selection.head.offset).toBe(0);
    });
  });

  test('a Tab over a selection lands after the struck words', () => {
    withSurface(plainParagraph('Alpha Beta Gamma'), (surface) => {
      selectIn(surface, 0, 'Alpha '.length, 'Alpha Beta'.length);
      surface.insertTab();
      expect(surface.state().lastRejection).toBeNull();
      const xml = serializeOoxmlPart(surface.session.part());
      // The strike then the tab, adjacent. (The tab itself is still written untracked in
      // suggesting mode — a separate attribution gap; this pins only where it lands.)
      expect(xml).toMatch(/<w:delText[^>]*>Beta<\/w:delText><\/w:r><\/w:del><w:r><w:tab\/>/);
      expect(surface.state().selection.head.offset).toBe('Alpha Beta'.length + 1);
    });
  });

  test('a range that removes a table still lands after the last struck paragraph', () => {
    const cell = (text: string) =>
      `<w:tc><w:tcPr><w:tcW w:w="4000" w:type="dxa"/></w:tcPr>${plainParagraph(text)}</w:tc>`;
    const table =
      '<w:tbl><w:tblPr><w:tblW w:w="8000" w:type="dxa"/></w:tblPr>' +
      '<w:tblGrid><w:gridCol w:w="4000"/><w:gridCol w:w="4000"/></w:tblGrid>' +
      `<w:tr>${cell('CellA')}${cell('CellB')}</w:tr></w:tbl>`;
    withSurface(plainParagraph('Alpha one') + table + plainParagraph('Beta two'), (surface) => {
      const last = surface.session.paragraphIds().length - 1;
      selectAcross(surface, 0, 0, last, 'Beta two'.length);
      typeEach(surface, 'New');
      expect(surface.state().lastRejection).toBeNull();
      // The fully covered table goes; the last paragraph survives and hosts the replacement.
      expect(paragraphTexts(surface)).toEqual(['Alpha one', 'Beta twoNew']);
      expect(surface.state().selection.head.offset).toBe('Beta twoNew'.length);
    });
  });
});

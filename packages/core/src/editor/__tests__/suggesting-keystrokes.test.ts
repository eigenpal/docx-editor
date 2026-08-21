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

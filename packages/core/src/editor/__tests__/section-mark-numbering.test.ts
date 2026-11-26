// A paragraph that holds only a section break takes no list number and does not advance the
// count (`w:pPr/w:sectPr`, `CT_SectPr`, ECMA-376 Part 1, 17.6.18; `CT_NumPr`, 17.3.1.19).
// Chinese thesis templates put such a paragraph, in the numbered `heading 1` style, before
// each chapter, so the next chapter keeps its own number. A numbered paragraph with no
// content and no section break keeps its number.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const WML = 'application/vnd.openxmlformats-officedocument.wordprocessingml';

const NUMBERING =
  `<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0">` +
  '<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="chineseCountingThousand"/>' +
  '<w:lvlText w:val="第%1章"/><w:suff w:val="space"/></w:lvl>' +
  '<w:lvl w:ilvl="1"><w:start w:val="1"/><w:isLgl/><w:numFmt w:val="decimal"/>' +
  '<w:lvlText w:val="%1.%2"/><w:suff w:val="space"/></w:lvl></w:abstractNum>' +
  '<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="1"/>' +
  '<w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum>' +
  '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>' +
  '<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>';

const numbered = (ilvl: number) =>
  `<w:pPr><w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="1"/></w:numPr></w:pPr>`;
const STYLES =
  `<w:styles xmlns:w="${W}">` +
  '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
  `<w:style w:type="paragraph" w:styleId="2"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/>${numbered(0)}</w:style>` +
  `<w:style w:type="paragraph" w:styleId="4"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/>${numbered(1)}</w:style>` +
  '</w:styles>';

const HEADER =
  '<w:p><w:fldSimple w:instr=" STYLEREF &quot;heading 1&quot; \\n "><w:r><w:t>cached</w:t></w:r></w:fldSimple>' +
  '<w:r><w:t xml:space="preserve"> </w:t></w:r>' +
  '<w:fldSimple w:instr=" STYLEREF &quot;heading 1&quot; "><w:r><w:t>cached</w:t></w:r></w:fldSimple></w:p>';

const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const paragraph = (style: string, content: string) =>
  `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}</w:pPr>${content}</w:p>`;
const chapter = (title: string) => paragraph('2', run(title));
const section = (title: string) => paragraph('4', run(title));
const text = (value: string) => paragraph('', run(value));

const sectPr = (header: boolean) =>
  `<w:sectPr>${header ? '<w:headerReference w:type="default" r:id="rHdr"/>' : ''}` +
  '<w:type w:val="nextPage"/><w:pgSz w:w="12240" w:h="15840"/>' +
  '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720"/>' +
  '</w:sectPr>';
const HEADING_1 = '<w:pStyle w:val="2"/>';
const HEADING_2 = '<w:pStyle w:val="4"/>';
/** Direct numbering, with no style and so no outline level. */
const LIST_ITEM = '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr>';
const item = (content: string) => `<w:p><w:pPr>${LIST_ITEM}</w:pPr>${content}</w:p>`;
/** A `heading 1` paragraph that holds only a section break, as the templates write it. */
const breakParagraph = (content = '', header = false, numbering = HEADING_1) =>
  `<w:p><w:pPr>${numbering}<w:spacing w:before="317"/>` +
  `<w:rPr><w:highlight w:val="none"/></w:rPr>${sectPr(header)}</w:pPr>${content}</w:p>`;

/** Bookmarks and an empty run draw nothing, so the paragraph still holds only the break. */
const markersOnly =
  '<w:bookmarkStart w:id="1" w:name="OLE_LINK1"/><w:bookmarkEnd w:id="1"/>' +
  '<w:proofErr w:type="spellStart"/><w:r><w:rPr><w:b/></w:rPr></w:r>';

const thesis =
  chapter('Intro') +
  section('Scope') +
  text('Body') +
  breakParagraph('', true) +
  chapter('Theory') +
  section('Graphs') +
  breakParagraph(markersOnly) +
  chapter('Results') +
  section('Data') +
  paragraph('2', '') +
  chapter('Summary') +
  sectPr(false);

function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Override PartName="/word/document.xml" ContentType="${WML}.document.main+xml"/>` +
        `<Override PartName="/word/numbering.xml" ContentType="${WML}.numbering+xml"/>` +
        `<Override PartName="/word/styles.xml" ContentType="${WML}.styles+xml"/>` +
        `<Override PartName="/word/header.xml" ContentType="${WML}.header+xml"/></Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="rNum" Type="${R}/numbering" Target="numbering.xml"/>` +
        `<Relationship Id="rSty" Type="${R}/styles" Target="styles.xml"/>` +
        `<Relationship Id="rHdr" Type="${R}/header" Target="header.xml"/></Relationships>`
    ),
    'word/numbering.xml': strToU8(NUMBERING),
    'word/styles.xml': strToU8(STYLES),
    'word/header.xml': strToU8(`<w:hdr xmlns:w="${W}">${HEADER}</w:hdr>`),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

function withSurface(bytes: Uint8Array, run: (surface: PaginatedSurface) => void): void {
  const container = document.createElement('div');
  document.body.append(container);
  const opened = mountPaginatedSurface(container, bytes);
  if (!opened.ok) throw new Error(opened.reason);
  try {
    run(opened.surface);
  } finally {
    opened.surface.destroy();
    container.remove();
  }
}

interface ParagraphLike {
  readonly kind: string;
  readonly marker?: { readonly text: string };
  readonly lines: readonly { readonly spans: readonly { readonly text: string }[] }[];
}
const textOf = (fragment: ParagraphLike) =>
  fragment.lines.flatMap((line) => line.spans.map((span) => span.text)).join('');

/** Per page, each body paragraph as `[marker]text`; `[]` is a paragraph without a marker. */
function bodyMarkers(surface: PaginatedSurface): string[][] {
  return surface
    .layout()
    .pages.map((page) =>
      (page.fragments as readonly ParagraphLike[])
        .filter((fragment) => fragment.kind === 'paragraph')
        .map((fragment) => `[${fragment.marker?.text ?? ''}]${textOf(fragment)}`)
    );
}

function headerTexts(surface: PaginatedSurface): string[] {
  return surface.layout().pages.map((page) =>
    ((page.header?.fragments ?? []) as readonly ParagraphLike[])
      .filter((fragment) => fragment.kind === 'paragraph')
      .map(textOf)
      .join('')
  );
}

const OPENED = [
  ['[第一章]Intro', '[1.1]Scope', '[]Body', '[]'],
  ['[第二章]Theory', '[2.1]Graphs', '[]'],
  ['[第三章]Results', '[3.1]Data', '[第四章]', '[第五章]Summary'],
];

describe('a paragraph that holds only a section break', () => {
  test('shows no list number and does not advance the count', () => {
    withSurface(docx(thesis), (surface) => {
      expect(bodyMarkers(surface)).toEqual(OPENED);
    });
  });

  test('leaves STYLEREF \\n in the header on the chapter number', () => {
    withSurface(docx(thesis), (surface) => {
      expect(headerTexts(surface)).toEqual(['第一章 Intro', '第二章 Theory', '第三章 Results']);
    });
  });

  test('takes a number when it gets content, and gives it back when the content goes', () => {
    withSurface(docx(thesis), (surface) => {
      const id = surface.session.paragraphIds()[3]!;
      surface.setSelection({
        anchor: { paragraphId: id, offset: 0 },
        head: { paragraphId: id, offset: 0 },
      });
      surface.type('X');
      const typed = [
        ['[第一章]Intro', '[1.1]Scope', '[]Body', '[第二章]X'],
        ['[第三章]Theory', '[3.1]Graphs', '[]'],
        ['[第四章]Results', '[4.1]Data', '[第五章]', '[第六章]Summary'],
      ];
      expect(bodyMarkers(surface)).toEqual(typed);
      expect(headerTexts(surface)).toEqual(['第一章 Intro', '第三章 Theory', '第四章 Results']);
      withSurface(surface.session.save(), (reopened) => {
        expect(bodyMarkers(reopened)).toEqual(typed);
      });

      surface.deleteBackward();
      expect(bodyMarkers(surface)).toEqual(OPENED);
      expect(headerTexts(surface)).toEqual(['第一章 Intro', '第二章 Theory', '第三章 Results']);
    });
  });

  test('in a list without headings, takes a number when it gets content', () => {
    const body =
      item(run('One')) + breakParagraph('', true, LIST_ITEM) + item(run('Two')) + sectPr(false);
    withSurface(docx(body), (surface) => {
      expect(bodyMarkers(surface)).toEqual([['[1.]One', '[]'], ['[2.]Two']]);
      const id = surface.session.paragraphIds()[1]!;
      surface.setSelection({
        anchor: { paragraphId: id, offset: 0 },
        head: { paragraphId: id, offset: 0 },
      });
      surface.type('X');
      expect(bodyMarkers(surface)).toEqual([['[1.]One', '[2.]X'], ['[3.]Two']]);
    });
  });

  test('skips the count at its own level and restarts no lower level', () => {
    const body =
      chapter('Intro') +
      section('Scope') +
      breakParagraph('', true, HEADING_2) +
      section('Graphs') +
      breakParagraph() +
      section('Data') +
      chapter('Theory') +
      section('Proof') +
      sectPr(false);
    withSurface(docx(body), (surface) => {
      expect(bodyMarkers(surface)).toEqual([
        ['[第一章]Intro', '[1.1]Scope', '[]'],
        ['[1.2]Graphs', '[]'],
        ['[1.3]Data', '[第二章]Theory', '[2.1]Proof'],
      ]);
    });
  });

  test('keeps its number when it holds a tab or text with the section break', () => {
    const body =
      chapter('Intro') +
      breakParagraph('<w:r><w:tab/></w:r>', true) +
      chapter('Theory') +
      breakParagraph(run('Closing')) +
      chapter('Results') +
      sectPr(false);
    withSurface(docx(body), (surface) => {
      expect(bodyMarkers(surface)).toEqual([
        ['[第一章]Intro', '[第二章]\t'],
        ['[第三章]Theory', '[第四章]Closing'],
        ['[第五章]Results'],
      ]);
    });
  });
});

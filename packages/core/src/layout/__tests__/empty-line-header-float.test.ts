// An empty body paragraph beside a wrapping picture in the HEADER moves below the picture
// when the picture leaves no passage beside it, as it does beside a body picture. Only a
// floating table, which places itself from the empty paragraph it anchors to, keeps empty
// paragraphs beside it in place.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart } from '@docx-editor.dev/core/store';
import {
  createFixedMeasurer,
  layoutHeaderFooterStory,
  layoutSemanticDocument,
  type PageFurniture,
  type SemanticLayout,
} from '../index.ts';
import {
  layoutContext,
  load as loadDrawingPart,
  squareAnchorAtLeft,
} from './anchored-drawing-test-fixtures.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const measurer = createFixedMeasurer(6, 14);
const EMU_PER_PT = 12700;
const NAME = '/word/header1.xml';

/** A header picture as wide as the content box, square-wrapped, at page y `topPt`. */
function wrappingHeader(topPt: number, heightPt: number) {
  const xml = squareAnchorAtLeft({ text: '' })
    .replace('<w:document ', '<w:hdr ')
    .replace('<w:body>', '')
    .replace('</w:body></w:document>', '</w:hdr>')
    .replace(
      'relativeFrom="column"><wp:posOffset>0',
      `relativeFrom="page"><wp:posOffset>${72 * EMU_PER_PT}`
    )
    .replace(
      'relativeFrom="paragraph"><wp:posOffset>0',
      `relativeFrom="page"><wp:posOffset>${topPt * EMU_PER_PT}`
    )
    .replaceAll('cx="1828800"', `cx="${468 * EMU_PER_PT}"`)
    .replaceAll('cy="914400"', `cy="${heightPt * EMU_PER_PT}"`);
  const part = loadDrawingPart(xml, NAME);
  return layoutHeaderFooterStory(
    part,
    468,
    measurer,
    NAME,
    undefined,
    undefined,
    undefined,
    128,
    undefined,
    undefined,
    layoutContext(part, NAME),
    undefined,
    undefined,
    {
      pageNumber: 1,
      pageWidth: 612,
      pageHeight: 792,
      marginLeft: 72,
      marginRight: 72,
      marginTop: 72,
      marginBottom: 72,
    }
  );
}

const p = (text: string) =>
  `<w:p><w:pPr><w:spacing w:after="0"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
const empty = '<w:p><w:pPr><w:spacing w:after="0"/></w:pPr></w:p>';

function lay(): SemanticLayout {
  const body =
    p('Lead') +
    empty.repeat(8) +
    p('Next') +
    '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>' +
    '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720"/></w:sectPr>';
  const part = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!part.ok) throw new Error(part.reason);
  const furniture: PageFurniture = {
    titlePage: false,
    evenAndOddHeaders: false,
    headers: new Map([['default', wrappingHeader(150, 100)]]) as PageFurniture['headers'],
    footers: new Map(),
  };
  return layoutSemanticDocument(part.part, 1, { measurer, sectionFurniture: [furniture] });
}

describe('an empty body paragraph beside a header picture', () => {
  test('moves below a header picture that leaves no passage', () => {
    const page = lay().pages[0]!;
    expect(page.header?.anchoredDrawings?.length).toBe(1);
    // Page y 150 to 250 is content y 78 to 178.
    const lines = page.fragments.flatMap((fragment) =>
      fragment.kind === 'paragraph' ? fragment.lines.map((line) => line.box) : []
    );
    for (const box of lines) {
      const overlaps = box.y + box.height > 78 + 0.01 && box.y < 178 - 0.01;
      expect(overlaps).toBe(false);
    }
  });
});

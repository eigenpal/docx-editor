// An opening document is laid out in growing prefixes on one session. Each prefix pass sees
// the whole story again, so work that reads every earlier block must be reused by node
// identity. This test pins the list work and the anchored drawing queries on a generated
// multi-section document, and checks that the prefix passes end in the layout that one full
// pass gives.

import { expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import type { DrawingProjection } from '../../store/package/drawing-projection.ts';
import type { InlineDrawingLayoutContext } from '../drawing-layout.ts';
import { paragraphFragmentsOf } from '../index.ts';
import type { SemanticLayout } from '../index.ts';
import { anchoredDrawingQueryTestRecorder } from '../drawing-atom-walk.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import { createLayoutSession } from '../layout-session.ts';
import { listResolveBlockVisitTestRecorder } from '../list-resolve.ts';
import { buildNumberingIndex } from '../numbering-index.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function part(xml: string, name: string): OoxmlPart {
  const result = readOoxmlPart(xml, { name, contentType: 'application/xml' });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const numberingIndex = buildNumberingIndex(
  part(
    `<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0">` +
      '<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/>' +
      '<w:lvlText w:val="%1."/><w:lvlJc w:val="left"/></w:lvl></w:abstractNum>' +
      '<w:num w:numId="5"><w:abstractNumId w:val="0"/></w:num></w:numbering>',
    '/word/numbering.xml'
  ).root
);

const SECTIONS = 4;
const PARAGRAPHS_PER_SECTION = 60;
const SECT_PR = '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>';

/** Sections of numbered and plain paragraphs; each section but the last ends in a break. */
function multiSectionDocument(): OoxmlPart {
  const blocks: string[] = [];
  for (let section = 0; section < SECTIONS; section += 1) {
    for (let index = 0; index < PARAGRAPHS_PER_SECTION; index += 1) {
      const last = index === PARAGRAPHS_PER_SECTION - 1 && section < SECTIONS - 1;
      const numbered = index % 2 === 0;
      const properties =
        (numbered ? '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="5"/></w:numPr>' : '') +
        (last ? SECT_PR : '');
      blocks.push(
        `<w:p>${properties ? `<w:pPr>${properties}</w:pPr>` : ''}` +
          `<w:r><w:t xml:space="preserve">Section ${section} paragraph ${index} holds ` +
          'enough words to wrap over more than one line of the page.</w:t></w:r></w:p>'
      );
    }
  }
  return part(
    `<w:document xmlns:w="${W}"><w:body>${blocks.join('')}${SECT_PR}</w:body></w:document>`,
    '/word/document.xml'
  );
}

/** What a reader sees: every paragraph fragment's place and text, page by page. */
const shapeOf = (layout: SemanticLayout): unknown =>
  layout.pages.map((page) =>
    paragraphFragmentsOf(page).map((fragment) => ({
      paragraphId: fragment.paragraphId,
      box: fragment.box,
      lines: fragment.lines.map((line) => ({
        box: line.box,
        text: line.spans.map((span) => span.text).join(''),
      })),
    }))
  );

test('prefix passes of a multi-section document do not repeat work for earlier blocks', () => {
  const document = multiSectionDocument();
  const measurer = createFixedMeasurer(6, 14);
  // A drawing context turns on the anchor pass setup, which reads each block of a section.
  const inlineDrawingLayout: InlineDrawingLayoutContext = {
    ownerPartName: '/word/document.xml',
    projectionForAtom: (): DrawingProjection | null => null,
    project: (): DrawingProjection | null => null,
    resourceOf: () => {
      throw new Error('a document without drawings reads no resource');
    },
  };
  const options = {
    measurer,
    numberingIndex,
    inlineDrawingLayout,
    compatibilityMode: 15,
    session: createLayoutSession(),
    cache: createParagraphLayoutCache(),
  };
  const total = SECTIONS * PARAGRAPHS_PER_SECTION;
  const recorder = listResolveBlockVisitTestRecorder();

  // The first prefix reads each block once.
  recorder.reset();
  layoutSemanticDocument(document, 1, { ...options, bodyBlockLimit: 20 });
  expect(recorder.blockScans).toBe(total);
  expect(recorder.paragraphCompares).toBe(0);

  // Later prefixes cross each section break. None reads a block's numbered paragraphs again
  // or compares a numbered paragraph with itself.
  recorder.reset();
  const drawingQueries = anchoredDrawingQueryTestRecorder();
  const queriesPerPass: number[] = [];
  let passes = 0;
  let prefix: SemanticLayout | undefined;
  for (let limit = 40; limit < total; limit += 20) {
    drawingQueries.reset();
    prefix = layoutSemanticDocument(document, 1, { ...options, bodyBlockLimit: limit });
    queriesPerPass.push(drawingQueries.queries);
    passes += 1;
  }
  expect(passes).toBeGreaterThan(SECTIONS);
  // Each pass adds the same number of blocks. The anchored drawing queries of a pass follow
  // those new blocks: they do not grow with the blocks that earlier passes placed.
  expect(Math.max(...queriesPerPass)).toBeLessThanOrEqual(queriesPerPass[0]!);
  expect(prefix!.pages.length).toBeGreaterThan(1);
  expect(recorder.blockScans).toBe(0);
  expect(recorder.paragraphCompares).toBe(0);

  // The pass that ends the open gives the layout of one full pass on a new session.
  const opened = layoutSemanticDocument(document, 1, options);
  expect(recorder.blockScans).toBe(0);
  expect(recorder.paragraphCompares).toBe(0);
  const fresh = layoutSemanticDocument(document, 1, {
    measurer,
    numberingIndex,
    inlineDrawingLayout,
    compatibilityMode: 15,
    session: createLayoutSession(),
    cache: createParagraphLayoutCache(),
  });
  expect(opened.pages.length).toBe(fresh.pages.length);
  expect(shapeOf(opened)).toEqual(shapeOf(fresh));
});

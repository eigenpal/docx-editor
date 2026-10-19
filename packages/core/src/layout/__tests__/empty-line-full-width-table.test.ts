import { expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlElement } from '../../store/package/ooxml-tree.ts';
import { createParagraphDrawingWrap } from '../paragraph-drawing-wrap.ts';
import type { ExclusionZone } from '../drawing-exclusion.ts';
import {
  createFixedMeasurer,
  createLayoutSession,
  layoutSemanticDocument,
} from '../semantic-layout.ts';
import type { ParagraphFragmentRecord } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const measurer = createFixedMeasurer(6, 14);
type Entry = NonNullable<
  ReturnType<Parameters<typeof createParagraphDrawingWrap>[0]['paragraphAt']>
>;
function load(body: string) {
  const value = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  });
  if (!value.ok) throw new Error(value.reason);
  return value.part;
}
const line = '<w:pPr><w:spacing w:before="0" w:after="0" w:line="280" w:lineRule="exact"/></w:pPr>';
const p = (text = '') => `<w:p>${line}${text ? `<w:r><w:t>${text}</w:t></w:r>` : ''}</w:p>`;
function input(pageBreak = false, floating = true, emptyContent = '') {
  const table =
    '<w:tbl><w:tblPr>' +
    (floating
      ? '<w:tblpPr w:leftFromText="180" w:rightFromText="180" w:vertAnchor="text" w:horzAnchor="margin" w:tblpY="86"/>'
      : '') +
    '<w:tblW w:w="9360" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr>' +
    '<w:tblGrid><w:gridCol w:w="9360"/></w:tblGrid><w:tr><w:trPr><w:trHeight w:val="2000" w:hRule="exact"/></w:trPr>' +
    `<w:tc><w:tcPr><w:tcW w:w="9360" w:type="dxa"/></w:tcPr>${p('Cell')}</w:tc></w:tr></w:tbl>`;
  return load(
    p('Lead') +
      table +
      `<w:p>${line}${emptyContent}</w:p>` +
      '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="700" w:lineRule="exact"/>' +
      (pageBreak ? '<w:pageBreakBefore/>' : '') +
      '</w:pPr></w:p>' +
      p('Next')
  );
}
function paragraphs(layout: ReturnType<typeof layoutSemanticDocument>) {
  return layout.pages.flatMap((page) =>
    page.fragments.filter((f): f is ParagraphFragmentRecord => f.kind === 'paragraph')
  );
}
function selected(markup = '<w:p/>', override: Partial<Entry> = {}) {
  const part = load(markup);
  const body = part.root.children.find(
    (n): n is OoxmlElement => n.kind !== 'text' && n.localName === 'body'
  )!;
  const paragraph = body.children.find((n): n is OoxmlElement => n.kind === 'paragraph')!;
  const entry: Entry = {
    paragraph,
    styleId: null,
    contextualSpacing: false,
    spacing: { after: 0 },
    ...override,
  };
  const base: ExclusionZone = {
    drawingNodeId: 'picture',
    anchorParagraphId: 'earlier-paragraph',
    anchorModelStart: 0,
    sourceOrder: 0,
    paintLayer: 'inFront',
    relativeHeight: 0,
    allowOverlap: true,
    columnIndex: 0,
    y: 0,
    verticalBand: { x: 0, y: 0, width: 468, height: 100 },
    input: {
      mode: 'topAndBottom',
      contentBounds: { x: 0, y: 0, width: 468, height: 100 },
      polygon: null,
      clipPolygon: null,
      wrapDistances: { top: 0, bottom: 0, left: 9, right: 9 },
      effectInsets: { top: 0, bottom: 0, left: 0, right: 0 },
      textSide: 'bothSides',
      contentLeft: 0,
      contentRight: 468,
    },
  };
  const zones: ExclusionZone[] = [
    { ...base, drawingNodeId: 'table', sourceKind: 'table' },
    {
      ...base,
      drawingNodeId: 'header-table',
      sourceKind: 'furniture',
      furnitureSource: { partName: '/word/header1.xml', kind: 'table', nodeId: 'T' },
    },
    base,
  ];
  const wrap = createParagraphDrawingWrap({
    paragraphAt: () => entry,
    paragraphOrder: new Map([
      [paragraph.id, 0],
      ['earlier-paragraph', 0],
    ]),
    paragraphIndex: () => 0,
    columnCount: 1,
  });
  return [wrap.select(entry, 0, 0, zones), wrap.select(entry, 0, 0, zones, { placement: true })];
}

test('full-width floating tables preserve empty paragraph positions and authored exact height', () => {
  const layout = layoutSemanticDocument(input(), 1, { measurer });
  const [lead, first, exact] = paragraphs(layout);
  expect(layout.pages).toHaveLength(1);
  expect(first!.box.y).toBeCloseTo(lead!.box.y + lead!.box.height, 6);
  expect(exact!.box.y).toBeCloseTo(first!.box.y + first!.box.height, 6);
  expect(exact!.lines[0]!.box.height).toBeCloseTo(35, 6);
  expect(paragraphs(layout)).toHaveLength(4);
});
test('ordinary text still clears a full-width floating table', () => {
  const layout = layoutSemanticDocument(input(), 1, { measurer });
  const table = layout.pages[0]!.fragments.find((f) => f.kind === 'table')!;
  const next = paragraphs(layout)[3]!;
  expect(next.lines[0]!.spans.map((s) => s.text).join('')).toBe('Next');
  expect(next.box.y).toBeGreaterThanOrEqual(table.box.y + table.box.height - 1e-6);
});
test('an authored page break on the empty paragraph still creates a new page', () => {
  const layout = layoutSemanticDocument(input(true), 1, { measurer });
  expect(layout.pages).toHaveLength(2);
  const exact = paragraphs(layout)[2]!;
  expect(exact.box.y).toBe(0);
  expect(exact.lines[0]!.box.height).toBeCloseTo(35, 6);
});
test('an in-flow table still consumes its full row height', () => {
  const layout = layoutSemanticDocument(input(false, false), 1, { measurer });
  const table = layout.pages[0]!.fragments.find((f) => f.kind === 'table')!;
  expect(paragraphs(layout)[1]!.box.y).toBeGreaterThanOrEqual(
    table.box.y + table.box.height - 1e-6
  );
});
test('pure paragraph marks exclude only body and furniture table bands', () => {
  for (const zones of selected()) expect(zones.map((z) => z.drawingNodeId)).toEqual(['picture']);
});
test('list markers and paragraph decorations retain table bands', () => {
  const frame = {
    x: 0,
    y: 0,
    width: 100,
    autoWidth: false,
    heightRule: 'auto' as const,
    horizontalAnchor: 'text' as const,
    verticalAnchor: 'text' as const,
    anchorLocked: false,
    token: 'frame',
    wrap: 'around' as const,
    hSpace: 0,
    vSpace: 0,
  };
  const overrides: Partial<Entry>[] = [
    { listItem: {} },
    { shading: 'ff0000' },
    { frame },
    { borders: { top: { val: 'single', color: null, widthPt: 0.5, spacePt: 0 } } },
  ];
  for (const override of overrides)
    for (const zones of selected('<w:p/>', override)) expect(zones).toHaveLength(3);
});
test('text runs fields drawings and hard breaks retain table bands', () => {
  for (const content of [
    '<w:r><w:t>X</w:t></w:r>',
    '<w:r><w:fldChar w:fldCharType="end"/></w:r>',
    '<w:r><w:br w:type="page"/></w:r>',
    '<w:r><w:drawing/></w:r>',
  ]) {
    for (const zones of selected(`<w:p>${content}</w:p>`)) expect(zones).toHaveLength(3);
  }
});
test('warm and cold empty-paragraph table wrapping produce the same layout', () => {
  const part = input(),
    session = createLayoutSession();
  layoutSemanticDocument(part, 1, { measurer, session });
  expect(layoutSemanticDocument(part, 2, { measurer, session }).pages).toEqual(
    layoutSemanticDocument(part, 2, { measurer }).pages
  );
});

const emptyForms = [
  '<w:r/>',
  '<w:r><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:r>',
  '<w:r><w:t/></w:r>',
  '<w:bookmarkStart w:id="1" w:name="empty"/><w:r/><w:bookmarkEnd w:id="1"/>',
];
test.each(emptyForms)('empty content retains table-adjacent placement: %s', (content) => {
  const layout = layoutSemanticDocument(input(false, true, content), 1, { measurer });
  const [lead, empty] = paragraphs(layout);
  expect(empty!.box.y).toBeCloseTo(lead!.box.y + lead!.box.height, 6);
  for (const zones of selected(`<w:p>${content}</w:p>`))
    expect(zones.map((zone) => zone.drawingNodeId)).toEqual(['picture']);
});
test.each([
  '<w:r><w:t xml:space="preserve"> </w:t></w:r>',
  '<w:r><w:tab/></w:r>',
  '<w:r><w:instrText> PAGE </w:instrText></w:r>',
  '<w:fldSimple w:instr="PAGE"/>',
  '<w:r><w:br/></w:r>',
])('visible or field content retains table bands: %s', (content) => {
  for (const zones of selected(`<w:p>${content}</w:p>`)) expect(zones).toHaveLength(3);
});

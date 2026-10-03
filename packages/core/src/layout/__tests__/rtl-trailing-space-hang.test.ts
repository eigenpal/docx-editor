// A right-to-left line's trailing spaces move to its left end, and hang off that end. The
// visible text aligns without them, so they never push it past the right margin (#1061).

import { expect, test } from 'bun:test';
import { readOoxmlPart, WML_NAMESPACE_URI } from '../../store/index.ts';
import {
  DEFAULT_DRAWING_PROJECTION_LIMITS,
  indexInlineDrawingProjectionsInPart,
  projectDrawing,
} from '../../store/package/drawing-projection.ts';
import type { ImageResourceState } from '../../store/package/image-resources.ts';
import type { OoxmlDrawingNode } from '../../store/package/ooxml-tree.ts';
import type { InlineDrawingLayoutContext } from '../drawing-layout.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { linesOf, type LineRecord } from '../semantic-records.ts';

const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const OWNER = '/word/document.xml';
const measurer = createFixedMeasurer(6, 14);
/** Letter page, one-inch margins: the measure runs from 0 to 468pt. */
const MEASURE = 468;

const READY: ImageResourceState = Object.freeze({
  kind: 'ready',
  partName: '/word/media/image1.png',
  contentId: 'c1',
  resourceKey: 'k-ready',
  mime: 'image/png',
  pixelWidth: 10,
  pixelHeight: 10,
  dpiX: 96,
  dpiY: 96,
});

const picture =
  '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
  '<wp:extent cx="381000" cy="381000"/><wp:docPr id="1" name="pic"/>' +
  `<a:graphic><a:graphicData uri="${PIC}">` +
  '<pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr>' +
  '<pic:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
  '<pic:spPr><a:xfrm><a:ext cx="381000" cy="381000"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr>' +
  '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';

const run = (text: string, rtl = false) =>
  `<w:r>${rtl ? '<w:rPr><w:rtl/></w:rPr>' : ''}<w:t xml:space="preserve">${text}</w:t></w:r>`;

function layout(content: string, jc = ''): readonly LineRecord[] {
  const parsed = readOoxmlPart(
    `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}"><w:body>` +
      `<w:p><w:pPr><w:bidi/>${jc ? `<w:jc w:val="${jc}"/>` : ''}</w:pPr>${content}</w:p>` +
      '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:left="1440" w:right="1440" w:top="1440" w:bottom="1440"/></w:sectPr>' +
      '</w:body></w:document>',
    { name: OWNER, contentType: 'application/xml' }
  );
  if (!parsed.ok) throw new Error(parsed.reason);
  const projections = indexInlineDrawingProjectionsInPart(parsed.part);
  const inlineDrawingLayout: InlineDrawingLayoutContext = Object.freeze({
    ownerPartName: OWNER,
    projectionForAtom: (atomId: string) => projections.get(atomId) ?? null,
    project: (node: OoxmlDrawingNode) =>
      projections.get(node.id) ??
      projectDrawing(node, { ownerPartName: OWNER, limits: DEFAULT_DRAWING_PROJECTION_LIMITS }),
    resourceOf: () => READY,
  });
  return linesOf(layoutSemanticDocument(parsed.part, 0, { measurer, inlineDrawingLayout }));
}

/** The visible text's extent, and the spaces' extent, on one line. */
function extents(line: LineRecord) {
  const ink = line.spans.filter((span) => span.text.trim() !== '');
  const spaces = line.spans.filter((span) => span.text.trim() === '');
  const extent = (spans: typeof ink) => ({
    start: Math.min(...spans.map((span) => span.box.x)),
    end: Math.max(...spans.map((span) => span.box.x + span.box.width)),
  });
  return { ink: extent(ink), spaces: spaces.length > 0 ? extent(spaces) : undefined };
}

const ltrTextRtlSpace = run('abc def') + run(' ', true);
/** The fixed measurer gives every character, the space included, the same advance. */
const ADVANCE = extents(layout(run('a'), 'end')[0]!).ink.end;
const TEXT = 7 * ADVANCE;

test('a trailing right-to-left space keeps left-to-right text flush with the right margin', () => {
  const { ink, spaces } = extents(layout(ltrTextRtlSpace)[0]!);
  expect(ink.end).toBeCloseTo(MEASURE, 5);
  expect(ink.start).toBeCloseTo(MEASURE - TEXT, 5);
  expect(spaces!.end).toBeCloseTo(ink.start, 5);
  expect(spaces!.start).toBeCloseTo(ink.start - ADVANCE, 5);
});

test('trailing spaces in the text run hang at the left of right-to-left text', () => {
  const { ink, spaces } = extents(layout(run('שלום עולם   ', true))[0]!);
  expect(ink.end).toBeCloseTo(MEASURE, 5);
  expect(spaces!.end).toBeCloseTo(ink.start, 5);
});

test('a centered line centers its text without the trailing spaces', () => {
  const { ink, spaces } = extents(layout(ltrTextRtlSpace, 'center')[0]!);
  expect(ink.start).toBeCloseTo((MEASURE - TEXT) / 2, 5);
  expect(spaces!.end).toBeCloseTo(ink.start, 5);
});

test('an end-aligned line keeps its text at the left margin and clips the spaces there', () => {
  const { ink, spaces } = extents(layout(ltrTextRtlSpace + run('    ', true), 'end')[0]!);
  expect(ink.start).toBeCloseTo(0, 5);
  expect(spaces!.start).toBeCloseTo(0, 5);
  expect(spaces!.end).toBeCloseTo(0, 5);
});

test('a justified wrapped line fills the measure, with its space at the left edge', () => {
  const lines = layout(run(Array(30).fill('שלום').join(' '), true), 'both');
  expect(lines.length).toBeGreaterThan(1);
  const { ink, spaces } = extents(lines[0]!);
  expect(ink.start).toBeCloseTo(0, 5);
  expect(ink.end).toBeCloseTo(MEASURE, 5);
  expect(spaces!.start).toBeGreaterThanOrEqual(0);
  expect(spaces!.end).toBeLessThanOrEqual(ink.start + 1e-6);
});

test('a justified wrapped line of mixed CJK and right-to-left text keeps every word', () => {
  const lines = layout(run(Array(12).fill('日本語 עברית').join(' '), true), 'both');
  expect(lines.length).toBeGreaterThan(1);
  const line = lines[0]!;
  const { ink } = extents(line);
  expect(ink.start).toBeCloseTo(0, 5);
  expect(ink.end).toBeCloseTo(MEASURE, 5);
  // Every visible span keeps its width: none is mistaken for a hanging space and clipped.
  for (const span of line.spans) {
    if (span.text.trim() !== '') expect(span.box.width).toBeGreaterThan(0);
  }
});

test('a page break after the trailing space does not push the text past the margin', () => {
  const { ink, spaces } = extents(layout(ltrTextRtlSpace + '<w:r><w:br w:type="page"/></w:r>')[0]!);
  expect(ink.end).toBeCloseTo(MEASURE, 5);
  expect(spaces!.end).toBeCloseTo(ink.start, 5);
});

// Picture lines carry no bidi shaping, so nothing reorders them: this guards that path.
test('an inline picture before the trailing space stays inside the right margin', () => {
  const line = layout(run('abc def') + picture + run(' ', true))[0]!;
  const drawing = line.drawings![0]!;
  expect(drawing.x + drawing.width).toBeCloseTo(MEASURE, 5);
  expect(extents(line).ink.end).toBeCloseTo(drawing.x, 5);
});

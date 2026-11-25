// A tab moves to the next line with an overflowing word (`w:tab`, Tab Character, `CT_Empty`,
// ECMA-376 Part 1, 17.3.3.32). The word breaks after the stop on that line only where a word
// after leading tabs may break. A floating object on the page or an anchor in the paragraph turns
// that break off, so the tab then moves only when the word fits after it on the next line.

import { expect, test } from 'bun:test';
import { readOoxmlPart } from '@docx-editor.dev/core/store';
import {
  DEFAULT_DRAWING_PROJECTION_LIMITS,
  indexInlineDrawingProjectionsInPart,
  projectDrawing,
} from '../../store/package/drawing-projection.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { paragraphFragmentsOf } from '../semantic-records.ts';

const OWNER = '/word/document.xml';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;

/** A 43pt square shape with square wrapping, far below the test paragraph. */
const shape =
  '<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" ' +
  'relativeHeight="1" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">' +
  '<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"><wp:posOffset>914400' +
  '</wp:posOffset></wp:positionH><wp:positionV relativeFrom="page"><wp:posOffset>7000000' +
  '</wp:posOffset></wp:positionV><wp:extent cx="548640" cy="548640"/>' +
  '<wp:wrapSquare wrapText="bothSides"/><wp:docPr id="1" name="s"/><a:graphic>' +
  `<a:graphicData uri="${WPS}"><wps:wsp><wps:cNvSpPr/><wps:spPr><a:xfrm><a:off x="0" y="0"/>` +
  '<a:ext cx="548640" cy="548640"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>' +
  '</wps:spPr><wps:bodyPr/></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>';

function lines(drawing: string, sameParagraph = false) {
  const tabbed = `${run('Text')}<w:r><w:tab/></w:r>${run('L'.repeat(90))}`;
  const body = sameParagraph
    ? `<w:p>${drawing}${tabbed}</w:p>`
    : `<w:p>${drawing}${run('Lead')}</w:p><w:p>${tabbed}</w:p>`;
  const read = readOoxmlPart(
    `<w:document xmlns:w="${W}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:wps="${WPS}"><w:body>${body}</w:body></w:document>`,
    { name: OWNER, contentType: 'app/xml' }
  );
  if (!read.ok) throw new Error(read.reason);
  const projections = indexInlineDrawingProjectionsInPart(read.part);
  const result = layoutSemanticDocument(read.part, 1, {
    measurer: createFixedMeasurer(6, 14),
    inlineDrawingLayout: {
      ownerPartName: OWNER,
      projectionForAtom: (id: string) => projections.get(id) ?? null,
      project: (node: Parameters<typeof projectDrawing>[0]) =>
        projections.get(node.id) ??
        projectDrawing(node, { ownerPartName: OWNER, limits: DEFAULT_DRAWING_PROJECTION_LIMITS }),
      resourceOf: () => ({ kind: 'missing', partName: null, reason: 'no-resource' }),
    } as never,
  });
  const fragments = paragraphFragmentsOf(result.pages[0]!);
  return fragments.at(-1)!.lines.map((line) => line.spans.map((span) => span.text).join(''));
}

test('without a floating object, the word breaks after the moved tab', () => {
  const texts = lines('');
  expect(texts[0]).toBe('Text');
  expect(texts[1]!.startsWith('\tL')).toBe(true);
});

test('a floating object on the page keeps the tab when the word fits no line after it', () => {
  const texts = lines(shape);
  expect(texts[0]).toBe('Text\t');
  expect(texts[1]!.startsWith('L')).toBe(true);
});

test('an anchor in the same paragraph keeps the tab when the word fits no line after it', () => {
  const texts = lines(shape, true);
  expect(texts[0]).toBe('Text\t');
  expect(texts[1]!.startsWith('L')).toBe(true);
});

// A top-level shape that turns or flips (`a:xfrm`, ECMA-376 Part 1, 20.1.7.6). An inline shape
// that turns nearer a quarter turn takes the room of its turned box on the line, and the text of
// a vertically flipped shape turns upside down.

import { describe, expect, test } from 'bun:test';
import { createFixedMeasurer, layoutSemanticDocument } from '../index.ts';
import { measureInlineDrawing, type InlineDrawingLayoutContext } from '../drawing-layout.ts';
import { readOoxmlPart } from '@docx-editor.dev/core/store';
import {
  DEFAULT_DRAWING_PROJECTION_LIMITS,
  indexInlineDrawingProjectionsInPart,
  projectDrawing,
} from '../../store/package/drawing-projection.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
const NS = `xmlns:w="${W}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:wps="${WPS}"`;
const PT = 12_700;
const CX = 120;
const CY = 72;

/** An inline shape of 120pt by 72pt, with or without text. */
function shape(xfrm: string, options: { text?: boolean; preset?: string } = {}): string {
  const story =
    options.text === false
      ? '<wps:bodyPr/>'
      : '<wps:txbx><w:txbxContent><w:p><w:r><w:t>ab</w:t></w:r></w:p></w:txbxContent></wps:txbx>' +
        '<wps:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0"><a:noAutofit/></wps:bodyPr>';
  return (
    '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
    `<wp:extent cx="${CX * PT}" cy="${CY * PT}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>` +
    '<wp:docPr id="1" name="S"/><wp:cNvGraphicFramePr/>' +
    `<a:graphic><a:graphicData uri="${WPS}"><wps:wsp><wps:cNvSpPr/><wps:spPr>` +
    `<a:xfrm${xfrm}><a:off x="0" y="0"/><a:ext cx="${CX * PT}" cy="${CY * PT}"/></a:xfrm>` +
    `<a:prstGeom prst="${options.preset ?? 'rect'}"><a:avLst/></a:prstGeom>` +
    '<a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:ln><a:noFill/></a:ln></wps:spPr>' +
    `${story}</wps:wsp></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`
  );
}

function source(run: string) {
  const doc = readOoxmlPart(
    `<w:document ${NS}><w:body><w:p>${run}</w:p><w:sectPr><w:pgSz w:w="12240" w:h="15840"/>` +
      '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>',
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!doc.ok) throw new Error(doc.reason);
  const part = doc.part;
  const atoms = indexInlineDrawingProjectionsInPart(part);
  const context: InlineDrawingLayoutContext = {
    ownerPartName: part.name,
    projectionForAtom: (atomId) => atoms.get(atomId) ?? null,
    project: (node) =>
      atoms.get(node.id) ??
      projectDrawing(node, { ownerPartName: part.name, limits: DEFAULT_DRAWING_PROJECTION_LIMITS }),
    resourceOf: () =>
      Object.freeze({
        kind: 'unrenderable' as const,
        partName: null,
        mime: 'unknown' as const,
        reason: 'unsupported-format' as const,
      }),
  };
  return { part, projection: [...atoms.values()][0]!, context };
}

function placed(run: string) {
  const { part, context } = source(run);
  const page = layoutSemanticDocument(part, 1, {
    measurer: createFixedMeasurer(6, 14),
    producer: 'test',
    inlineDrawingLayout: context,
  }).pages[0]!;
  for (const fragment of page.fragments) {
    if (fragment.kind !== 'paragraph') continue;
    for (const line of fragment.lines)
      if (line.drawings?.[0]) return { line, drawing: line.drawings[0] };
  }
  throw new Error('no inline drawing');
}

describe('an inline shape that turns', () => {
  // [45, 135) and [225, 315) degrees lie nearer a quarter turn.
  for (const degrees of [90, 270, 60, 120, 45, 134, 225, 314, -90]) {
    test(`a ${degrees}-degree turn takes the room of the turned box`, () => {
      const measure = measureInlineDrawing(source(shape(` rot="${degrees * 60_000}"`)).projection);
      // The extent keeps its size; the line holds the box with its sides swapped.
      expect([measure.width, measure.height]).toEqual([CX, CY]);
      expect(measure.totalWidth).toBe(CY);
      expect(measure.lineContribution).toBe(CX);
    });
  }

  for (const degrees of [0, 30, 44, 135, 180, 200, 224, 315]) {
    test(`a ${degrees}-degree turn keeps the room of the extent`, () => {
      const measure = measureInlineDrawing(source(shape(` rot="${degrees * 60_000}"`)).projection);
      expect(measure.totalWidth).toBe(CX);
      expect(measure.lineContribution).toBe(CY);
    });
  }

  test('a turned shape without text takes the room of its turned box too', () => {
    const measure = measureInlineDrawing(
      source(shape(' rot="5400000"', { text: false, preset: 'triangle' })).projection
    );
    expect(measure.totalWidth).toBe(CY);
    expect(measure.lineContribution).toBe(CX);
  });

  test('the extent is centred on the turned box, on the line', () => {
    const upright = placed(shape(''));
    const { line, drawing } = placed(shape(' rot="5400000"'));
    // The turned box starts where the upright extent starts; the extent is centred on it.
    expect(drawing.x).toBeCloseTo(upright.drawing.x - (CX - CY) / 2, 6);
    expect(drawing.y - line.box.y).toBeCloseTo((CX - CY) / 2, 6);
    expect(line.box.height).toBeGreaterThanOrEqual(CX);
    expect([drawing.width, drawing.height]).toEqual([CX, CY]);
  });
});

describe('a top-level shape that flips', () => {
  test('a vertical flip turns the text upside down about the box centre', () => {
    const story = placed(shape(' flipV="1"')).drawing.textboxStory!;
    expect(story.contentRotation?.degrees).toBe(180);
    expect(story.contentRotation?.pivot).toEqual({ x: CX / 2, y: CY / 2 });
    // The shape's outline is already flipped: it does not turn.
    expect(story.chromeRotationDegrees).toBeUndefined();
  });

  test('a horizontal flip keeps the text readable', () => {
    expect(placed(shape(' flipH="1"')).drawing.textboxStory!.contentRotation).toBeUndefined();
  });

  test('a vertical flip and a turn add up', () => {
    const story = placed(shape(' flipV="1" rot="5400000"')).drawing.textboxStory!;
    expect(story.contentRotation?.degrees).toBe(270);
    expect(story.chromeRotationDegrees).toBe(90);
  });

  test('a flipped right triangle keeps its text in the mirrored rectangle', () => {
    const story = placed(shape(' flipV="1"', { preset: 'rtTriangle' })).drawing.textboxStory!;
    // The rectangle from (w/12, 7h/12) mirrors to the top; the half turn carries it to the
    // other side, so the frame's own top-left is the turned rectangle's.
    expect(story.contentWidth).toBeCloseTo(CX / 2, 6);
    expect(story.contentHeight).toBeCloseTo(CY / 3, 6);
    expect(story.contentOffset.x).toBeCloseTo(CX - CX / 12 - CX / 2, 6);
    expect(story.contentOffset.y).toBeCloseTo(CY - CY / 12 - CY / 3, 6);
    // The frame turns about its own centre and stays there.
    expect(story.contentRotation).toEqual({
      degrees: 180,
      pivot: { x: CX - CX / 12 - CX / 4, y: CY - CY / 12 - CY / 6 },
    });
  });
});

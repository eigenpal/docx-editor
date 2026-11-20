// Every layout pass asks each paragraph for its anchored drawing atoms. A paragraph without
// drawing atoms must answer without a walk and without a new list, and a paragraph with
// drawing atoms must read its projection again on every call.

import { expect, test } from 'bun:test';
import { readOoxmlPart } from '@docx-editor.dev/core/store';
import type { DrawingProjection } from '../../store/package/drawing-projection.ts';
import { createDrawingExclusionPasses } from '../drawing-exclusion-passes.ts';
import { anchoredDrawingQueryTestRecorder } from '../drawing-atom-walk.ts';
import {
  anchoredDrawingAtomsInParagraph,
  type InlineDrawingLayoutContext,
} from '../drawing-layout.ts';
import { storyBlocks } from '../story-roots.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

function blocksOf(body: string) {
  const read = readOoxmlPart(
    `<w:document xmlns:w="${W}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
      `<w:body>${body}</w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!read.ok) throw new Error(read.reason);
  return storyBlocks(read.part);
}

function countingContext(answer: () => DrawingProjection | null) {
  const counts = { asked: 0 };
  const context: InlineDrawingLayoutContext = {
    ownerPartName: '/word/document.xml',
    projectionForAtom: () => {
      counts.asked += 1;
      return answer();
    },
    project: () => {
      counts.asked += 1;
      return answer();
    },
    resourceOf: () => {
      throw new Error('not read by the atom walk');
    },
  };
  return { context, counts };
}

const ANCHORED = { kind: 'anchored' } as unknown as DrawingProjection;
const TEXT = '<w:p><w:r><w:t>Plain text</w:t></w:r></w:p>';
const DRAWING =
  '<w:p><w:r><w:drawing>' +
  '<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" behindDoc="0" locked="0"' +
  ' allowOverlap="1" layoutInCell="1" relativeHeight="1">' +
  '<wp:simplePos x="0" y="0"/>' +
  '<wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH>' +
  '<wp:positionV relativeFrom="page"><wp:posOffset>457200</wp:posOffset></wp:positionV>' +
  '<wp:extent cx="1828800" cy="914400"/><wp:wrapNone/><wp:docPr id="1" name="pic1"/>' +
  `<a:graphic><a:graphicData uri="${PIC}"><pic:pic><pic:nvPicPr>` +
  '<pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr>' +
  '<pic:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
  '<pic:spPr><a:xfrm><a:ext cx="1828800" cy="914400"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr>' +
  '</pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r></w:p>';

test('a paragraph without drawing atoms answers later passes with one shared empty list', () => {
  const [paragraph] = blocksOf(TEXT);
  const { context, counts } = countingContext(() => ANCHORED);
  const first = anchoredDrawingAtomsInParagraph(paragraph!, context);
  const second = anchoredDrawingAtomsInParagraph(paragraph!, context);
  const third = anchoredDrawingAtomsInParagraph(paragraph!, countingContext(() => null).context);
  expect(first).toHaveLength(0);
  // No list for each call: every answer is the same frozen object, under any context.
  expect(second).toBe(first);
  expect(third).toBe(first);
  expect(Object.isFrozen(first)).toBe(true);
  expect(counts.asked).toBe(0);
});

test('a paragraph with a drawing atom reads its projection again on every call', () => {
  const [paragraph] = blocksOf(DRAWING);
  let projection: DrawingProjection | null = ANCHORED;
  const { context } = countingContext(() => projection);
  expect(anchoredDrawingAtomsInParagraph(paragraph!, context)).toHaveLength(1);
  // A projection can change with no change to the paragraph node, so the answer is not kept.
  projection = null;
  const none = anchoredDrawingAtomsInParagraph(paragraph!, context);
  expect(none).toHaveLength(0);
  projection = ANCHORED;
  expect(anchoredDrawingAtomsInParagraph(paragraph!, context)).toHaveLength(1);
  // The empty answer in between was the shared list; the later answer did not write to it.
  expect(none).toHaveLength(0);
});

test('pass setup still finds consecutive anchor-only paragraphs after earlier setups', () => {
  const blocks = blocksOf(TEXT + DRAWING + DRAWING);
  const { context } = countingContext(() => ANCHORED);
  for (let pass = 0; pass < 3; pass += 1)
    expect(createDrawingExclusionPasses(blocks, context, 4, 15).maxPasses).toBe(8);
  // Text between two anchor-only paragraphs separates them, also once it is known to hold no
  // drawing and the setup skips it.
  const separated = blocksOf(DRAWING + TEXT + DRAWING);
  for (let pass = 0; pass < 3; pass += 1)
    expect(createDrawingExclusionPasses(separated, context, 4, 15).maxPasses).toBe(4);
  // A story of text only keeps the ordinary budget, also once its paragraphs are known.
  const text = blocksOf(TEXT.repeat(3));
  for (let pass = 0; pass < 3; pass += 1)
    expect(createDrawingExclusionPasses(text, context, 4, 15).maxPasses).toBe(4);
});

test('pass setup queries a block again only when the block can hold an anchor', () => {
  const blocks = blocksOf(TEXT.repeat(100) + DRAWING + TEXT.repeat(100));
  const { context } = countingContext(() => ANCHORED);
  const recorder = anchoredDrawingQueryTestRecorder();
  recorder.reset();
  // The first setup reads each paragraph once.
  createDrawingExclusionPasses(blocks, context, 4, 15);
  expect(recorder.queries).toBe(201);
  // Later setups, one for each layout pass, read only the paragraph that holds a drawing.
  recorder.reset();
  for (let pass = 0; pass < 8; pass += 1) createDrawingExclusionPasses(blocks, context, 4, 15);
  expect(recorder.queries).toBe(8);
});

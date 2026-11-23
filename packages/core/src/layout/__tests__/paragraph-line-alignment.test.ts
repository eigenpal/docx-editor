// `wp:align` against a paragraph or a line (ECMA-376 Part 1 §20.4.3.2 ST_AlignV, §20.4.3.5
// ST_RelFromV), in the body and in a table cell.

import { describe, expect, test } from 'bun:test';
import { WML_NAMESPACE_URI } from '../../store/package/ooxml-tree.ts';
import { layoutContext, load } from './anchored-drawing-test-fixtures.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { anchoredDrawingsOf } from '../semantic-records.ts';

const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const measurer = createFixedMeasurer(6, 14);
/** 457200 EMU is 36pt. */
const SIZE = 457200;
const PICTURE = 36;

type Frame = 'paragraph' | 'line';
type Align = 'top' | 'center' | 'bottom';

function picture(frame: Frame, align: Align): string {
  return (
    '<w:r><w:drawing>' +
    '<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" behindDoc="0" locked="0" allowOverlap="1" layoutInCell="1" relativeHeight="1">' +
    '<wp:simplePos x="0" y="0"/>' +
    '<wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH>' +
    `<wp:positionV relativeFrom="${frame}"><wp:align>${align}</wp:align></wp:positionV>` +
    `<wp:extent cx="${SIZE}" cy="${SIZE}"/><wp:wrapNone/><wp:docPr id="1" name="p"/>` +
    '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    '<pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr>' +
    '<pic:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
    `<pic:spPr><a:xfrm><a:ext cx="${SIZE}" cy="${SIZE}"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr>` +
    '</pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>'
  );
}

function pictureTop(frame: Frame, align: Align, inCell: boolean): number {
  const before = '<w:p><w:r><w:t>Earlier text</w:t></w:r></w:p>'.repeat(2);
  const anchor = `<w:p>${picture(frame, align)}<w:r><w:t>Anchor text</w:t></w:r></w:p>`;
  const content = inCell
    ? '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="6000"/></w:tblGrid><w:tr><w:tc>' +
      `${before}${anchor}</w:tc></w:tr></w:tbl><w:p/>`
    : `${before}${anchor}`;
  const part = load(
    `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
      `<w:body><w:p><w:r><w:t>Intro</w:t></w:r></w:p>${content}</w:body></w:document>`
  );
  const page = layoutSemanticDocument(part, 1, {
    measurer,
    inlineDrawingLayout: layoutContext(part),
  }).pages[0]!;
  return anchoredDrawingsOf(page)[0]!.y;
}

describe('alignment against a paragraph or a line in the body', () => {
  test('center and bottom place a paragraph picture at the paragraph top', () => {
    const top = pictureTop('paragraph', 'top', false);
    expect(pictureTop('paragraph', 'center', false)).toBeCloseTo(top, 6);
    expect(pictureTop('paragraph', 'bottom', false)).toBeCloseTo(top, 6);
  });

  test('center and bottom align a line picture to the line top', () => {
    const top = pictureTop('line', 'top', false);
    expect(pictureTop('line', 'center', false)).toBeCloseTo(top - PICTURE / 2, 6);
    expect(pictureTop('line', 'bottom', false)).toBeCloseTo(top - PICTURE, 6);
  });
});

describe('alignment against a paragraph or a line in a table cell', () => {
  for (const frame of ['paragraph', 'line'] as const)
    test(`center and bottom place a ${frame} picture where top does`, () => {
      const top = pictureTop(frame, 'top', true);
      expect(pictureTop(frame, 'center', true)).toBeCloseTo(top, 6);
      expect(pictureTop(frame, 'bottom', true)).toBeCloseTo(top, 6);
    });
});

// A DrawingML inline picture follows its run's `w:position` (17.3.2.24): a signed offset in
// half-points that raises or lowers the picture against the text baseline. A line that
// snaps to a section line grid (17.6.5) holds the whole picture line in grid pitches.

import { describe, expect, test } from 'bun:test';
import {
  WML_NAMESPACE_URI,
  readOoxmlPart,
  type OoxmlPart,
} from '../../store/package/ooxml-tree.ts';
import {
  DEFAULT_DRAWING_PROJECTION_LIMITS,
  indexInlineDrawingProjectionsInPart,
  projectDrawing,
} from '../../store/package/drawing-projection.ts';
import type { ImageResourceState } from '../../store/package/image-resources.ts';
import type { InlineDrawingLayoutContext } from '../drawing-layout.ts';
import { caretBoxOnLine } from '../semantic-hit-test.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';
import { squareWrapZone } from './float-over-table-harness.ts';
import { paragraphFragmentsOf } from '../semantic-records.ts';

const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const OWNER = '/word/document.xml';
const measurer = createFixedMeasurer(6, 14);
const PICTURE_PT = 30;
const PICTURE_EMU = PICTURE_PT * 12_700;
/** A 312-twip line pitch. */
const PITCH_PT = 15.6;

const READY: ImageResourceState = Object.freeze({
  kind: 'ready',
  partName: '/word/media/image1.png',
  contentId: 'image1',
  resourceKey: 'k1',
  mime: 'image/png',
  pixelWidth: 40,
  pixelHeight: 40,
  dpiX: 96,
  dpiY: 96,
});

function pictureRun(runProperties: string): string {
  return (
    `<w:r><w:rPr>${runProperties}</w:rPr><w:drawing>` +
    '<wp:inline distT="0" distB="0" distL="0" distR="0">' +
    `<wp:extent cx="${PICTURE_EMU}" cy="${PICTURE_EMU}"/><wp:docPr id="1" name="picture"/>` +
    `<a:graphic><a:graphicData uri="${PIC}"><pic:pic>` +
    '<pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr>' +
    '<pic:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
    `<pic:spPr><a:xfrm><a:ext cx="${PICTURE_EMU}" cy="${PICTURE_EMU}"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr>` +
    '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>'
  );
}

function documentWith(options: {
  readonly runProperties?: string;
  readonly paragraphProperties?: string;
  readonly grid?: boolean;
}): OoxmlPart {
  const xml =
    `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
    '<w:body><w:p>' +
    (options.paragraphProperties ? `<w:pPr>${options.paragraphProperties}</w:pPr>` : '') +
    '<w:r><w:t xml:space="preserve">Before </w:t></w:r>' +
    pictureRun(options.runProperties ?? '') +
    '<w:r><w:t xml:space="preserve"> after</w:t></w:r></w:p>' +
    (options.grid ? '<w:sectPr><w:docGrid w:type="lines" w:linePitch="312"/></w:sectPr>' : '') +
    '</w:body></w:document>';
  return parsePart(xml, OWNER);
}

function parsePart(xml: string, name: string): OoxmlPart {
  const result = readOoxmlPart(xml, { name, contentType: 'application/xml' });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

/** A character style that lowers its runs by 6pt. */
const LOWERED_STYLE = buildStyleCascadeTable(
  parsePart(
    `<w:styles xmlns:w="${WML_NAMESPACE_URI}"><w:style w:type="character" w:styleId="Lowered">` +
      '<w:name w:val="Lowered"/><w:rPr><w:position w:val="-12"/></w:rPr></w:style></w:styles>',
    '/word/styles.xml'
  ).root
);

function layoutContext(part: OoxmlPart): InlineDrawingLayoutContext {
  const atoms = indexInlineDrawingProjectionsInPart(part);
  return {
    ownerPartName: OWNER,
    projectionForAtom: (atomId) => atoms.get(atomId) ?? null,
    project: (node) =>
      atoms.get(node.id) ??
      projectDrawing(node, { ownerPartName: OWNER, limits: DEFAULT_DRAWING_PROJECTION_LIMITS }),
    resourceOf: () => READY,
  };
}

function firstLine(part: OoxmlPart, styleCascade?: typeof LOWERED_STYLE) {
  const layout = layoutSemanticDocument(part, 1, {
    measurer,
    inlineDrawingLayout: layoutContext(part),
    ...(styleCascade ? { styleCascade } : {}),
  });
  return paragraphFragmentsOf(layout.pages[0]!)[0]!.lines[0]!;
}

/** The picture bottom against the line's text baseline: positive is below it. */
function pictureDrop(line: ReturnType<typeof firstLine>): number {
  const picture = line.drawings![0]!;
  return picture.y + picture.height - line.box.y - line.baseline;
}

describe('run position on a DrawingML inline picture', () => {
  test('a lowered picture ends below the baseline and the line holds its depth', () => {
    const plain = firstLine(documentWith({}));
    const lowered = firstLine(documentWith({ runProperties: '<w:position w:val="-12"/>' }));
    expect(pictureDrop(plain)).toBeCloseTo(0, 6);
    expect(pictureDrop(lowered)).toBeCloseTo(6, 6);
    expect(lowered.baseline).toBeCloseTo(plain.baseline - 6, 6);
    // The picture's 6pt depth exceeds the text descent, so the picture sets the line foot.
    expect(lowered.box.height).toBeCloseTo(PICTURE_PT, 6);
  });

  test('a raised picture lifts the baseline and keeps the text descent below it', () => {
    const plain = firstLine(documentWith({}));
    const raised = firstLine(documentWith({ runProperties: '<w:position w:val="12"/>' }));
    expect(pictureDrop(raised)).toBeCloseTo(-6, 6);
    expect(raised.baseline).toBeCloseTo(plain.baseline + 6, 6);
    expect(raised.box.height).toBeCloseTo(plain.box.height + 6, 6);
  });

  test('a character style supplies the position', () => {
    const styled = documentWith({ runProperties: '<w:rStyle w:val="Lowered"/>' });
    expect(pictureDrop(firstLine(styled, LOWERED_STYLE))).toBeCloseTo(6, 6);
    expect(pictureDrop(firstLine(styled))).toBeCloseTo(0, 6);
  });

  test('an exact line keeps its height and moves only the picture', () => {
    const exact = '<w:spacing w:line="480" w:lineRule="exact"/>';
    const plain = firstLine(documentWith({ paragraphProperties: exact }));
    const lowered = firstLine(
      documentWith({ paragraphProperties: exact, runProperties: '<w:position w:val="-12"/>' })
    );
    expect(lowered.box.height).toBeCloseTo(24, 6);
    expect(lowered.baseline).toBeCloseTo(plain.baseline, 6);
    expect(pictureDrop(lowered)).toBeCloseTo(6, 6);
  });

  test('the caret at the picture follows the moved picture', () => {
    const line = firstLine(documentWith({ runProperties: '<w:position w:val="-12"/>' }));
    const picture = line.drawings![0]!;
    const caret = caretBoxOnLine(line, picture.start, measurer);
    expect(caret.y).toBeCloseTo(picture.y, 6);
    expect(caret.height).toBeCloseTo(picture.height, 6);
  });
});

describe('a picture line on a section line grid', () => {
  test('the line takes whole pitches and centres the picture with its text', () => {
    const natural = firstLine(documentWith({}));
    const snapped = firstLine(documentWith({ grid: true }));
    const height = Math.ceil(natural.box.height / PITCH_PT) * PITCH_PT;
    const above = (height - natural.box.height) / 2;
    expect(snapped.box.height).toBeCloseTo(height, 6);
    expect(snapped.baseline).toBeCloseTo(natural.baseline + above, 6);
    expect(pictureDrop(snapped)).toBeCloseTo(0, 6);
    // Like a snapped text line, the centring below the content may hang past the page foot.
    expect(snapped.trailingSpacing ?? 0).toBeCloseTo(above, 6);
  });

  test('a paragraph that turns snapping off keeps the natural picture line', () => {
    const natural = firstLine(documentWith({}));
    const unsnapped = firstLine(
      documentWith({ grid: true, paragraphProperties: '<w:snapToGrid w:val="0"/>' })
    );
    expect(unsnapped.box.height).toBeCloseTo(natural.box.height, 6);
    expect(unsnapped.baseline).toBeCloseTo(natural.baseline, 6);
  });

  test('a minimum-height picture line on the grid lets its centring hang as well', () => {
    const atLeast = '<w:spacing w:line="240" w:lineRule="atLeast"/>';
    const natural = firstLine(documentWith({}));
    const snapped = firstLine(documentWith({ grid: true, paragraphProperties: atLeast }));
    const height = Math.ceil(natural.box.height / PITCH_PT) * PITCH_PT;
    expect(snapped.box.height).toBeCloseTo(height, 6);
    expect(snapped.trailingSpacing ?? 0).toBeCloseTo((height - natural.box.height) / 2, 6);
  });

  test('an exact picture line keeps its height on the grid', () => {
    const exact = '<w:spacing w:line="480" w:lineRule="exact"/>';
    const line = firstLine(documentWith({ grid: true, paragraphProperties: exact }));
    expect(line.box.height).toBeCloseTo(24, 6);
  });

  test('a lowered picture snaps with its whole band', () => {
    const lowered = '<w:position w:val="-10"/>';
    const natural = firstLine(documentWith({ runProperties: lowered }));
    const snapped = firstLine(documentWith({ grid: true, runProperties: lowered }));
    const height = Math.ceil(natural.box.height / PITCH_PT) * PITCH_PT;
    expect(snapped.box.height).toBeCloseTo(height, 6);
    expect(pictureDrop(snapped)).toBeCloseTo(5, 6);
  });
});

describe('a positioned picture beside a float', () => {
  /** The first line with a full-width square-wrapped float 34pt below the paragraph top. */
  function lineAboveFloat(runProperties: string) {
    const part = documentWith({ runProperties });
    const paragraph = part.root.children
      .flatMap((node) => node.children)
      .find((node) => node.kind === 'paragraph')!;
    const layout = layoutSemanticDocument(part, 0, {
      measurer,
      inlineDrawingLayout: layoutContext(part),
      drawingExclusionPass: 0,
      drawingExclusionZonesByPage: new Map([
        [
          0,
          [
            squareWrapZone({
              anchorParagraphId: paragraph.id,
              top: 34,
              height: 40,
              left: 0,
              width: 468,
              contentWidth: 468,
            }),
          ],
        ],
      ]),
    });
    return paragraphFragmentsOf(layout.pages[0]!)[0]!.lines[0]!;
  }

  test('a raised picture that reaches the float moves its line below it', () => {
    expect(lineAboveFloat('').box.y).toBeCloseTo(0, 6);
    expect(lineAboveFloat('<w:position w:val="12"/>').box.y).toBeGreaterThanOrEqual(74);
  });

  test('a lowered picture whose line stays clear of the float keeps its place', () => {
    expect(lineAboveFloat('<w:position w:val="-12"/>').box.y).toBeCloseTo(0, 6);
  });
});

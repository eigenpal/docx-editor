// `w:lineRule="auto"` on a line carrying an inline drawing (17.3.1.33).
//
// The multiple scales the TEXT line. Word grows an image line to contain the image and stops
// there — it does not scale the image's own extent — so a content-width picture in a
// paragraph carrying Word's default 279/240 must not pick up a band of dead space under it.

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
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { paragraphFragmentsOf } from '../semantic-records.ts';

const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PIC_URI = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const OWNER = '/word/document.xml';

const measurer = createFixedMeasurer(6, 14);
/** The measurer's 6pt/14pt base describes an 11pt run, so fixtures author `w:sz="22"`. */
const TEXT_LINE_PT = 14;
/** US-Letter content column: 468pt, which is what a full-width picture is authored at. */
const CONTENT_WIDTH_EMU = 5_943_600;
const PICTURE_HEIGHT_EMU = 4_457_700;
const PICTURE_HEIGHT_PT = 351;
/** Word writes this into `docDefaults` for every new document: a 1.1625 multiple. */
const WORD_DEFAULT_LINE = 279;

const READY: ImageResourceState = Object.freeze({
  kind: 'ready',
  partName: '/word/media/image1.png',
  contentId: 'image1',
  resourceKey: 'k1',
  mime: 'image/png',
  pixelWidth: 504,
  pixelHeight: 378,
  dpiX: 96,
  dpiY: 96,
});

function documentWith(options: {
  readonly spacing?: string;
  readonly cx?: number;
  readonly cy?: number;
  readonly caption?: string;
}): OoxmlPart {
  const cx = options.cx ?? CONTENT_WIDTH_EMU;
  const cy = options.cy ?? PICTURE_HEIGHT_EMU;
  const xml =
    `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
    '<w:body><w:p>' +
    (options.spacing ? `<w:pPr><w:spacing ${options.spacing}/></w:pPr>` : '') +
    '<w:r><w:drawing>' +
    '<wp:inline distT="0" distB="0" distL="0" distR="0">' +
    `<wp:extent cx="${cx}" cy="${cy}"/>` +
    '<wp:docPr id="1" name="picture"/>' +
    `<a:graphic><a:graphicData uri="${PIC_URI}"><pic:pic>` +
    '<pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr>' +
    '<pic:blipFill><a:blip r:embed="rId1"/><a:srcRect/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
    `<pic:spPr><a:xfrm><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr>` +
    '</pic:pic></a:graphicData></a:graphic>' +
    '</wp:inline></w:drawing></w:r>' +
    `<w:r><w:rPr><w:sz w:val="22"/></w:rPr><w:t>${options.caption ?? 'This is a caption'}</w:t></w:r>` +
    '</w:p></w:body></w:document>';
  const result = readOoxmlPart(xml, {
    name: OWNER,
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

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

function linesOfFirstParagraph(part: OoxmlPart) {
  const layout = layoutSemanticDocument(part, 1, {
    measurer,
    inlineDrawingLayout: layoutContext(part),
  });
  return paragraphFragmentsOf(layout.pages[0]!)[0]!.lines;
}

describe('auto line spacing on a line carrying an inline drawing', () => {
  test('a content-width picture is not scaled by the paragraph multiple', () => {
    const lines = linesOfFirstParagraph(
      documentWith({ spacing: `w:line="${WORD_DEFAULT_LINE}" w:lineRule="auto"` })
    );
    // The picture fills the column, so the caption wraps to its own line.
    expect(lines).toHaveLength(2);
    expect(lines[0]!.drawings ?? []).toHaveLength(1);
    expect(lines[0]!.box.height).toBeCloseTo(PICTURE_HEIGHT_PT, 4);
    // The caption sits directly under the picture — no dead band between them.
    expect(lines[1]!.box.y).toBeCloseTo(PICTURE_HEIGHT_PT, 4);
    expect(lines[1]!.box.height).toBeCloseTo((TEXT_LINE_PT * WORD_DEFAULT_LINE) / 240, 4);
  });

  test('single spacing leaves the same picture line unchanged', () => {
    const single = linesOfFirstParagraph(documentWith({}));
    const multiple = linesOfFirstParagraph(
      documentWith({ spacing: `w:line="${WORD_DEFAULT_LINE}" w:lineRule="auto"` })
    );
    expect(multiple[0]!.box.height).toBeCloseTo(single[0]!.box.height, 4);
  });

  test('a multiple taller than the picture still wins', () => {
    // A picture shorter than the text line: the multiple governs, exactly as it does on a
    // line of plain text. The drawing only ever raises the floor.
    const lines = linesOfFirstParagraph(
      documentWith({
        spacing: 'w:line="480" w:lineRule="auto"',
        cx: 152_400,
        cy: 76_200,
        caption: 'x',
      })
    );
    expect(lines[0]!.drawings ?? []).toHaveLength(1);
    expect(lines[0]!.box.height).toBeCloseTo(TEXT_LINE_PT * 2, 4);
  });

  test('atLeast and exact are untouched by the text-band rule', () => {
    const atLeast = linesOfFirstParagraph(
      documentWith({ spacing: 'w:line="7200" w:lineRule="atLeast"' })
    );
    // atLeast is a floor in twips: 360pt beats the 351pt picture.
    expect(atLeast[0]!.box.height).toBeCloseTo(360, 4);

    const exact = linesOfFirstParagraph(
      documentWith({ spacing: 'w:line="1440" w:lineRule="exact"' })
    );
    // exact overrides the box outright; the picture overflows per the content-clip policy.
    expect(exact[0]!.box.height).toBeCloseTo(72, 4);
  });

  test('a picture narrower than the column shares its line with the caption', () => {
    const lines = linesOfFirstParagraph(
      documentWith({
        spacing: `w:line="${WORD_DEFAULT_LINE}" w:lineRule="auto"`,
        cx: 914_400,
        cy: 914_400,
        caption: 'x',
      })
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]!.box.height).toBeCloseTo(72, 4);
  });
});

// Painting a line that carries two paragraphs.
//
// A resolved display mode draws a merged run as one paragraph, so the join line holds spans —
// and inline images — from two of them. Both members count their offsets from zero, so an
// image at offset 0 in the second half and an image at offset 0 in the first are numerically
// identical. Anything that ordered or matched drawings by offset alone answered for the
// wrong half.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_DRAWING_PROJECTION_LIMITS,
  projectDrawing,
} from '../../store/package/drawing-projection.ts';
import { mockReadyImageResource } from '../../store/__tests__/drawing-ready-fixture.ts';
import {
  WML_NAMESPACE_URI,
  readOoxmlPart,
  type OoxmlPart,
} from '../../store/package/ooxml-tree.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../../layout/semantic-layout.ts';
import { lineSegments } from '../../layout/line-segments.ts';
import { paragraphFragmentsOf } from '../../layout/semantic-records.ts';
import { paintSemanticLayout } from '../semantic-paint.ts';
import type { PaintImageUrlPort } from '../semantic-paint-drawings.ts';

const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const OWNER = '/word/document.xml';

const READY = mockReadyImageResource({
  bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]),
  pixelWidth: 40,
  pixelHeight: 20,
});

const urlPort: PaintImageUrlPort = {
  create: (handle, mime) => `blob:fake/${mime}/${handle.resourceKey}`,
  revoke: () => {},
};

/** A small inline picture, narrow enough that two of them share one line. */
const picture =
  '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
  '<wp:extent cx="228600" cy="114300"/><wp:docPr id="1" name="p"/>' +
  '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
  '<pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr>' +
  '<pic:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
  '<pic:spPr><a:xfrm><a:ext cx="228600" cy="114300"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr>' +
  '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';

/** Each half opens with a picture, so the two pictures are at the SAME model offset. */
function mergedWithPictures(): OoxmlPart {
  const xml =
    `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" ` +
    `xmlns:pic="${PIC}" xmlns:r="${R}"><w:body>` +
    '<w:p><w:pPr><w:rPr><w:del w:id="1" w:author="A"/></w:rPr></w:pPr>' +
    `${picture}<w:r><w:t xml:space="preserve">AAA </w:t></w:r></w:p>` +
    `<w:p>${picture}<w:r><w:t>BBB</w:t></w:r></w:p>` +
    '</w:body></w:document>';
  const result = readOoxmlPart(xml, {
    name: OWNER,
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function layoutMerged() {
  return layoutSemanticDocument(mergedWithPictures(), 1, {
    measurer: createFixedMeasurer(6, 14),
    displayMode: 'proposed',
    inlineDrawingLayout: {
      ownerPartName: OWNER,
      project: (node) =>
        projectDrawing(node, { ownerPartName: OWNER, limits: DEFAULT_DRAWING_PROJECTION_LIMITS }),
      resourceOf: () => READY,
    },
  });
}

describe('two paragraphs of images on one line', () => {
  test('the join line holds two drawings at the same offset in different paragraphs', () => {
    // The ambiguity itself, stated as a fact about the records. Every offset-only lookup
    // over this line is a coin toss, and this is the fixture that makes it one.
    const fragment = paragraphFragmentsOf(layoutMerged().pages[0]!)[0]!;
    const line = fragment.lines[0]!;
    const drawings = line.drawings ?? [];
    expect(drawings).toHaveLength(2);
    expect(drawings[0]!.start).toBe(drawings[1]!.start);
    expect(drawings[0]!.paragraphId).not.toBe(drawings[1]!.paragraphId);
    expect(lineSegments(line)).toHaveLength(2);
  });

  test('each half paints its own advance, in its own half', () => {
    // Ordered by offset alone, both spacers flushed before the FIRST half's text: the
    // second image's advance opened a gap in the wrong paragraph and left none in its own.
    const container = document.createElement('div');
    paintSemanticLayout(container, layoutMerged(), {
      scale: 1,
      imageUrlPort: urlPort,
      ariaHidden: false,
    });
    const line = container.querySelector('.docx-line');
    expect(line).toBeTruthy();
    const shape: string[] = [];
    for (const child of Array.from(line!.children)) {
      if (child.classList.contains('docx-inline-drawing-advance')) shape.push('advance');
      else if ((child.textContent ?? '').trim().length > 0) {
        shape.push((child.textContent ?? '').trim());
      }
    }
    expect(shape).toEqual(['advance', 'AAA', 'advance', 'BBB']);
  });
});

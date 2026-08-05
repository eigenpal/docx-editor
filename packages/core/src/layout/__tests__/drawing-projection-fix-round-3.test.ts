// Task 8 fix round 3 — signed wrap polygon coordinates, over-limit refusal, semantic clip hits.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, WML_NAMESPACE_URI, type OoxmlPart } from '../../store/index.ts';
import {
  DEFAULT_DRAWING_PROJECTION_LIMITS,
  indexInlineDrawingProjectionsInPart,
  projectDrawingsInPart,
  projectDrawing,
} from '../../store/package/drawing-projection.ts';
import type { ImageResourceState } from '../../store/package/image-resources.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../index.ts';
import { hitTestPage } from '../semantic-hit-test.ts';
import { linesOf } from '../semantic-records.ts';
import type { InlineDrawingLayoutContext } from '../drawing-layout.ts';

const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const OWNER = '/word/document.xml';
const measurer = createFixedMeasurer(6, 14);

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

const run = (text: string) => `<w:r><w:t>${text}</w:t></w:r>`;

function inlineEllipseInner(): string {
  return (
    '<w:drawing>' +
    '<wp:inline distT="0" distB="0" distL="0" distR="0">' +
    '<wp:extent cx="914400" cy="457200"/>' +
    '<wp:docPr id="1" name="pic"/>' +
    `<a:graphic><a:graphicData uri="${PIC}">` +
    '<pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId1"/><a:srcRect/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
    '<pic:spPr><a:xfrm><a:ext cx="914400" cy="457200"/></a:xfrm><a:prstGeom prst="ellipse"/></pic:spPr>' +
    '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>'
  );
}

function anchoredWrapPolygonXml(points: string): string {
  return `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}"><w:body><w:p><w:r><w:t>anchor</w:t></w:r><w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="251658240" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV><wp:extent cx="914400" cy="457200"/><wp:wrapTight wrapText="bothSides" distT="0" distB="0" distL="0" distR="0"><wp:wrapPolygon edited="0">${points}</wp:wrapPolygon></wp:wrapTight><wp:docPr id="1" name="x"/><a:graphic><a:graphicData uri="${PIC}"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId1"/><a:srcRect/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="457200"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r></w:p></w:body></w:document>`;
}

function loadBody(inner: string): OoxmlPart {
  const xml = `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}"><w:body>${inner}</w:body></w:document>`;
  const parsed = readOoxmlPart(xml, {
    name: OWNER,
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  });
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.part;
}

function indexedContext(part: OoxmlPart): InlineDrawingLayoutContext {
  const atomProjections = indexInlineDrawingProjectionsInPart(part);
  return Object.freeze({
    ownerPartName: OWNER,
    projectionForAtom: (atomId) => atomProjections.get(atomId) ?? null,
    project: (node) =>
      atomProjections.get(node.id) ??
      projectDrawing(node, { ownerPartName: OWNER, limits: DEFAULT_DRAWING_PROJECTION_LIMITS }),
    resourceOf: () => READY,
  });
}

describe('fix round 3 — wrap polygon ST_Coordinate parsing', () => {
  test('negative polygon coordinates project without unsigned clamp', () => {
    const parsed = readOoxmlPart(
      anchoredWrapPolygonXml(
        '<wp:start x="-91440" y="-45720"/><wp:lineTo x="914400" y="0"/><wp:lineTo x="914400" y="457200"/>'
      ),
      {
        name: OWNER,
        contentType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
      }
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(parsed.reason);
    const projection = projectDrawingsInPart(parsed.part)[0]!;
    expect(projection.wrapGeometry!.polygon[0]).toEqual({ x: -91440, y: -45720 });
  });

  test('over-limit polygon demotes typed wrap at parse boundary', () => {
    const lineTos = Array.from(
      { length: 520 },
      (_, index) => `<wp:lineTo x="${index + 1}" y="${index + 1}"/>`
    ).join('');
    const parsed = readOoxmlPart(anchoredWrapPolygonXml(`<wp:start x="0" y="0"/>${lineTos}`), {
      name: OWNER,
      contentType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(parsed.reason);
    expect(projectDrawingsInPart(parsed.part).length).toBe(0);
  });

  test('out-of-range ST_Coordinate demotes typed wrap at parse boundary', () => {
    const parsed = readOoxmlPart(
      anchoredWrapPolygonXml(
        '<wp:start x="0" y="0"/><wp:lineTo x="9223372036854775808" y="1"/><wp:lineTo x="1" y="1"/>'
      ),
      {
        name: OWNER,
        contentType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
      }
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(parsed.reason);
    expect(projectDrawingsInPart(parsed.part).length).toBe(0);
  });
});

describe('fix round 3 — semantic hit testing uses clip geometry', () => {
  test('inline ellipse corner inside hitBounds misses; center hits', () => {
    const part = loadBody(`<w:p>${run('A')}<w:r>${inlineEllipseInner()}</w:r>${run('B')}</w:p>`);
    const layout = layoutSemanticDocument(part, 1, {
      measurer,
      inlineDrawingLayout: indexedContext(part),
    });
    const line = linesOf(layout)[0]!;
    const drawing = line.drawings![0]!;
    const cornerHit = hitTestPage(layout, 0, {
      x: drawing.hitBounds.x + 1,
      y: line.box.y + drawing.hitBounds.y + 1,
    });
    const centerHit = hitTestPage(layout, 0, {
      x: drawing.x + drawing.width / 2,
      y: line.box.y + drawing.y + drawing.height / 2,
    });
    expect(cornerHit?.drawing).toBeNull();
    expect(centerHit?.drawing?.drawingNodeId).toBe(drawing.drawingNodeId);
  });
});

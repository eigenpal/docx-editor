/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Picture effects projected through the installed effects renderer: a glow under the
// picture, and the reflection and soft edge the picture paints with.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, WML_NAMESPACE_URI } from '../../../../core/src/store/index.ts';
import {
  projectDrawingsInPart,
  type DrawingProjection,
} from '../../../../core/src/store/package/drawing-projection.ts';
import { installDrawing } from '../index.ts';

installDrawing();

const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
const CX = 1_371_600;
const CY = 914_400;

function project(payload: string, uri: string, cy = CY): DrawingProjection {
  const xml =
    `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" ` +
    `xmlns:pic="${PIC}" xmlns:r="${R}" xmlns:wps="${WPS}"><w:body><w:p><w:r><w:drawing>` +
    `<wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${CX}" cy="${cy}"/>` +
    `<wp:docPr id="1" name="Picture 1"/><a:graphic><a:graphicData uri="${uri}">${payload}` +
    `</a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p></w:body></w:document>`;
  const parsed = readOoxmlPart(xml, {
    name: '/word/document.xml',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  });
  if (!parsed.ok) throw new Error(parsed.reason);
  const [projection] = projectDrawingsInPart(parsed.part);
  expect(projection).toBeTruthy();
  return projection!;
}

function picture(spPrTail: string, xfrmAttributes = ''): DrawingProjection {
  return project(
    `<pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="p.png"/><pic:cNvPicPr/></pic:nvPicPr>` +
      `<pic:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
      `<pic:spPr><a:xfrm${xfrmAttributes}><a:off x="0" y="0"/><a:ext cx="${CX}" cy="${CY}"/>` +
      `</a:xfrm>${spPrTail}</pic:spPr></pic:pic>`,
    PIC
  );
}

const RECT = '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>';

describe('picture effects', () => {
  test('a glow paints under the picture', () => {
    const projection = picture(
      `${RECT}<a:effectLst><a:glow rad="50800"><a:srgbClr val="4472C4"/></a:glow></a:effectLst>`
    );
    const [halo] = projection.vectorShape!.components;
    expect(halo).toMatchObject({ belowPicture: true, shadowOnly: true, strokeWidthEmu: 50800 });
  });

  test('a reflection and soft edges reach the picture projection', () => {
    const reflected = picture(
      `${RECT}` +
        '<a:effectLst><a:reflection blurRad="6350" stA="52000" endA="300" endPos="35000" ' +
        'dir="5400000" sy="-100000" algn="bl" rotWithShape="0"/></a:effectLst>'
    );
    expect(reflected.picture!.frameEffects?.reflection).toEqual({
      startAlpha: 0.52,
      endAlpha: 0.003,
      endPosition: 0.35,
      distanceEmu: 0,
      blurEmu: 6350,
    });
    const soft = picture(`${RECT}<a:effectLst><a:softEdge rad="76200"/></a:effectLst>`);
    expect(soft.picture!.frameEffects?.softEdgeEmu).toBe(76200);
  });

  test('a turned picture paints no effects', () => {
    const projection = picture(
      `${RECT}<a:effectLst><a:glow rad="50800"><a:srgbClr val="4472C4"/></a:glow>` +
        '<a:softEdge rad="76200"/></a:effectLst>',
      ' rot="5400000"'
    );
    expect(projection.vectorShape).toBeNull();
    expect(projection.picture!.frameEffects).toBeUndefined();
  });
});

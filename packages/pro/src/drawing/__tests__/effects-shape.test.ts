/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Shape effects beyond the outer shadow, projected through the installed effects renderer:
// glow, inner shadow, and the rim of a dark-edged bevel.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, WML_NAMESPACE_URI } from '../../../../core/src/store/index.ts';
import { projectDrawingsInPart } from '../../../../core/src/store/package/drawing-projection.ts';
import type { VectorShapeProjection } from '../../../../core/src/store/package/drawing-shape-projection.ts';
import { installDrawing } from '../index.ts';

installDrawing();

const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
const WPG = 'http://schemas.microsoft.com/office/word/2010/wordprocessingGroup';
const WPC = 'http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas';
const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const V = 'urn:schemas-microsoft-com:vml';

function parsePart(body: string) {
  const xml =
    `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" ` +
    `xmlns:wps="${WPS}" xmlns:wpg="${WPG}" xmlns:wpc="${WPC}" xmlns:mc="${MC}" xmlns:v="${V}">` +
    `<w:body>${body}</w:body></w:document>`;
  const parsed = readOoxmlPart(xml, {
    name: '/word/document.xml',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  });
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.part;
}

function inline(cx: number, cy: number, uri: string, payload: string): string {
  return (
    `<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">` +
    `<wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="1" name="Shape 1"/>` +
    `<a:graphic><a:graphicData uri="${uri}">${payload}</a:graphicData></a:graphic>` +
    `</wp:inline></w:drawing></w:r></w:p>`
  );
}

function shape(spPr: string, extra = ''): string {
  return `<wps:wsp><wps:cNvSpPr/><wps:spPr>${spPr}</wps:spPr>${extra}<wps:bodyPr/></wps:wsp>`;
}

function onlyVector(body: string): VectorShapeProjection {
  const [projection] = projectDrawingsInPart(parsePart(body));
  expect(projection?.vectorShape).toBeTruthy();
  return projection!.vectorShape!;
}

const XFRM = '<a:xfrm><a:off x="0" y="0"/><a:ext cx="1000000" cy="500000"/></a:xfrm>';
const FILL = '<a:solidFill><a:srgbClr val="336699"/></a:solidFill>';

describe('dark-edged bevels', () => {
  test('a dark-edged bevel adds an inset rim over the fill', () => {
    const bevel = '<a:sp3d prstMaterial="dkEdge"><a:bevelT w="8200" h="38100"/></a:sp3d>';
    const vector = onlyVector(
      inline(1000000, 500000, WPS, shape(`${XFRM}<a:prstGeom prst="rect"/>${FILL}${bevel}`))
    );
    const rim = vector.components.at(-1)!;
    expect(rim.fillHex).toBeNull();
    expect(rim.strokeHex).toBe('000000');
    expect(rim.strokeInset).toBe(true);
    expect(rim.strokeWidthEmu).toBe(8200);
    const plain = onlyVector(
      inline(
        1000000,
        500000,
        WPS,
        shape(
          `${XFRM}<a:prstGeom prst="rect"/>${FILL}<a:sp3d prstMaterial="matte"><a:bevelT/></a:sp3d>`
        )
      )
    );
    expect(plain.components).toHaveLength(1);
  });
});

describe('glows', () => {
  const glow =
    '<a:effectLst><a:glow rad="127000"><a:srgbClr val="FFC000"><a:alpha val="60000"/>' +
    '</a:srgbClr></a:glow></a:effectLst>';

  test('a glow is a halo under the shape: the outline widened and blurred in its colour', () => {
    const vector = onlyVector(
      inline(1000000, 500000, WPS, shape(`${XFRM}<a:prstGeom prst="ellipse"/>${FILL}${glow}`))
    );
    const [halo, body] = vector.components;
    expect(halo).toMatchObject({
      shadowOnly: true,
      fillHex: 'FFC000',
      strokeHex: 'FFC000',
      strokeWidthEmu: 127000,
      shadow: { dxEmu: 0, dyEmu: 0, hex: 'FFC000' },
    });
    expect(halo!.shadow!.blurEmu).toBeCloseTo((127000 * 2) / 3, 6);
    expect(halo!.shadow!.alpha).toBeCloseTo(0.6, 6);
    expect(body!.fillHex).toBe('336699');
  });

  test('a line glows around its stroke', () => {
    const line = '<a:ln w="25400"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:ln>';
    const vector = onlyVector(
      inline(
        1000000,
        0,
        WPS,
        shape(`${XFRM.replace('cy="500000"', 'cy="0"')}<a:prstGeom prst="line"/>${line}${glow}`)
      )
    );
    expect(vector.components[0]).toMatchObject({
      shadowOnly: true,
      fillHex: null,
      strokeWidthEmu: 127000 + 25400,
    });
  });
});

describe('inner shadows', () => {
  test('an inner shadow paints over the fill, clipped to the shape, on its own side', () => {
    const effect =
      '<a:effectLst><a:innerShdw blurRad="63500" dist="50800" dir="13500000">' +
      '<a:prstClr val="black"><a:alpha val="50000"/></a:prstClr></a:innerShdw></a:effectLst>';
    const vector = onlyVector(
      inline(1000000, 500000, WPS, shape(`${XFRM}<a:prstGeom prst="ellipse"/>${FILL}${effect}`))
    );
    const [body, inner] = vector.components;
    expect(body!.fillHex).toBe('336699');
    expect(inner).toMatchObject({ shadowOnly: true, fillHex: '000000' });
    expect(inner!.clipEmu).toEqual(body!.subpathsEmu);
    // A frame around the shape casts it: the frame moves away from the shadow's direction.
    expect(inner!.subpathsEmu).toHaveLength(body!.subpathsEmu.length + 1);
    expect(inner!.shadow!.dxEmu).toBeGreaterThan(0);
    expect(inner!.shadow!.dyEmu).toBeGreaterThan(0);
    expect(inner!.shadow!.alpha).toBeCloseTo(0.5, 6);
  });
});

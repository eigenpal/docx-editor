/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// 3-D charts: the projection rules, face culling and shading, the box, bar and series-row
// geometry, surface bands, the contour view and the 3-D pie.

import { describe, expect, test } from 'bun:test';
import {
  projectDrawingsInPackage,
  type DrawingProjection,
} from '../../../../core/src/store/package/drawing-projection.ts';
import type { OoxmlElement, OoxmlNode } from '../../../../core/src/store/package/ooxml-tree.ts';
import {
  C,
  chartPackage,
  numCache,
  series,
  strCache,
} from '../../../../core/src/store/__tests__/chart-fixture.ts';
import { boxHeight } from '../chart-3d-cartesian.ts';
import { FaceList, fitProjection, signedArea, type View3D } from '../chart-3d.ts';
import { scaleValues, type ValueInfo } from '../chart-axes.ts';
import { DEFAULT_CHART_TEXT } from '../chart-labels.ts';
import { autoValueScale } from '../chart-scale.ts';
import type { ChartScene } from '../chart-scene.ts';
import { installDrawing } from '../index.ts';

installDrawing();

const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CATEGORIES = ['North', 'South', 'East', 'West'];
const BOX = { l: 0, t: 0, r: 400, b: 200 };

function view(overrides: Partial<View3D>): View3D {
  return {
    rotX: 15,
    rotY: 20,
    depthPercent: 100,
    hPercent: null,
    rightAngles: true,
    perspective: 30,
    ...overrides,
  };
}

function chart3D(plotArea: string, view3D: string, legend = ''): string {
  return (
    `<c:chartSpace xmlns:c="${C}" xmlns:a="${A}" xmlns:r="${R}"><c:chart>` +
    `<c:autoTitleDeleted val="1"/>${view3D}<c:plotArea><c:layout/>${plotArea}</c:plotArea>` +
    `${legend ? `<c:legend><c:legendPos val="${legend}"/></c:legend>` : ''}` +
    '<c:plotVisOnly val="1"/></c:chart></c:chartSpace>'
  );
}

const VIEW_RIGHT_ANGLES =
  '<c:view3D><c:rotX val="15"/><c:rotY val="20"/><c:depthPercent val="100"/><c:rAngAx val="1"/></c:view3D>';
const VIEW_PERSPECTIVE =
  '<c:view3D><c:rotX val="15"/><c:rotY val="20"/><c:depthPercent val="100"/><c:rAngAx val="0"/>' +
  '<c:perspective val="30"/></c:view3D>';
const AXES_3 =
  '<c:catAx><c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/>' +
  '<c:axPos val="b"/><c:majorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="2"/></c:catAx>' +
  '<c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/>' +
  '<c:axPos val="l"/><c:majorGridlines/><c:numFmt formatCode="General" sourceLinked="1"/>' +
  '<c:majorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="1"/>' +
  '<c:crossBetween val="between"/></c:valAx>' +
  '<c:serAx><c:axId val="3"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/>' +
  '<c:axPos val="b"/><c:majorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="2"/></c:serAx>';
const AXES_2 = AXES_3.slice(0, AXES_3.indexOf('<c:serAx>'));

function project(chartXml: string): DrawingProjection {
  const projections = projectDrawingsInPackage(chartPackage(chartXml));
  expect(projections).toHaveLength(1);
  return projections[0]!;
}

function textOf(node: OoxmlNode): string {
  if (node.kind === 'textValue') return node.value;
  return (node as OoxmlElement).children.map(textOf).join('');
}

function labels(projection: DrawingProjection): { text: string; x: number; y: number }[] {
  return (projection.groupTextboxes ?? []).map((box) => ({
    text: textOf(box.story.content),
    x: box.frameEmu.x + box.frameEmu.cx / 2,
    y: box.frameEmu.y + box.frameEmu.cy / 2,
  }));
}

const unsupported = (projection: DrawingProjection) =>
  projection.diagnostics.filter((diagnostic) => diagnostic.code === 'unsupported-graphic');

function bounds(path: readonly { x: number; y: number }[]) {
  const xs = path.map((point) => point.x);
  const ys = path.map((point) => point.y);
  return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

describe('3-D projection', () => {
  test('right-angle axes keep the front face square on and shift depth by the sines', () => {
    const projection = fitProjection(view({}), { w: 300, h: 150, d: 60 }, BOX);
    const s = projection.scale;
    const origin = projection.point({ x: 0, y: 0, z: 0 });
    const right = projection.point({ x: 300, y: 0, z: 0 });
    const up = projection.point({ x: 0, y: 150, z: 0 });
    const back = projection.point({ x: 0, y: 0, z: 60 });
    expect(right.y).toBeCloseTo(origin.y, 6);
    expect(up.x).toBeCloseTo(origin.x, 6);
    expect((back.x - origin.x) / s).toBeCloseTo(60 * Math.sin((20 * Math.PI) / 180), 6);
    expect((origin.y - back.y) / s).toBeCloseTo(60 * Math.sin((15 * Math.PI) / 180), 6);
  });

  test('the fitted box keeps two points clear of the plot area and is centred in it', () => {
    const projection = fitProjection(view({}), { w: 300, h: 150, d: 60 }, BOX);
    const corners = [0, 300].flatMap((x) =>
      [0, 150].flatMap((y) => [0, 60].map((z) => projection.point({ x, y, z })))
    );
    const left = Math.min(...corners.map((p) => p.x));
    const right = Math.max(...corners.map((p) => p.x));
    const top = Math.min(...corners.map((p) => p.y));
    const bottom = Math.max(...corners.map((p) => p.y));
    expect(Math.min(left, top, 400 - right, 200 - bottom)).toBeCloseTo(2, 6);
    expect((left + right) / 2).toBeCloseTo(200, 6);
    expect((top + bottom) / 2).toBeCloseTo(100, 6);
  });

  test('a turned box without perspective recovers its turn and tilt from the edges', () => {
    const projection = fitProjection(
      view({ rightAngles: false, perspective: 0 }),
      { w: 300, h: 150, d: 300 },
      BOX
    );
    const origin = projection.point({ x: 0, y: 0, z: 0 });
    const right = projection.point({ x: 300, y: 0, z: 0 });
    const back = projection.point({ x: 0, y: 0, z: 300 });
    // Along x: (cos turn, sin turn sin tilt); along z: (sin turn, -cos turn sin tilt).
    const tanTurnSinTilt = (right.y - origin.y) / (right.x - origin.x);
    const sinTiltOverTanTurn = (origin.y - back.y) / (back.x - origin.x);
    const sinTilt = Math.sqrt(tanTurnSinTilt * sinTiltOverTanTurn);
    expect((Math.asin(sinTilt) * 180) / Math.PI).toBeCloseTo(15, 6);
    expect((Math.atan(tanTurnSinTilt / sinTilt) * 180) / Math.PI).toBeCloseTo(20, 6);
  });

  test('perspective draws the near edge of a box larger than the far one', () => {
    const flat = fitProjection(
      view({ rightAngles: false, perspective: 0 }),
      { w: 300, h: 150, d: 300 },
      BOX
    );
    const deep = fitProjection(
      view({ rightAngles: false, perspective: 30 }),
      { w: 300, h: 150, d: 300 },
      BOX
    );
    const edge = (projection: typeof flat, z: number) =>
      projection.point({ x: 0, y: 150, z }).y - projection.point({ x: 0, y: 0, z }).y;
    expect(edge(flat, 0) / edge(flat, 300)).toBeCloseTo(1, 6);
    expect(edge(deep, 0) / edge(deep, 300)).toBeGreaterThan(1.1);
  });

  test('only the faces of a box that face the viewer paint, shaded by side', () => {
    const projection = fitProjection(view({}), { w: 100, h: 100, d: 100 }, BOX);
    const faces = new FaceList();
    faces.box(0, 100, 0, 100, 0, 100, { hex: '4472C4', alpha: 1 }, null);
    const fills: string[] = [];
    const scene = {
      path: (_paths: unknown, _closed: boolean, fill: { hex: string } | null) =>
        fills.push(fill!.hex),
      line: () => {},
    } as unknown as ChartScene;
    faces.paint(projection, scene);
    // Front, right side and top: the base colour, 0.64 and 0.76 of it.
    expect(fills.sort()).toEqual(['2C497D', '345795', '4472C4']);
  });

  test('faces wound as seen from outside have a positive screen area', () => {
    const projection = fitProjection(view({}), { w: 100, h: 100, d: 100 }, BOX);
    const front = [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 100, z: 0 },
      { x: 100, y: 100, z: 0 },
      { x: 100, y: 0, z: 0 },
    ].map((point) => projection.point(point));
    expect(signedArea(front)).toBeGreaterThan(0);
    expect(signedArea([...front].reverse())).toBeLessThan(0);
  });
});

describe('3-D axis scale', () => {
  test('3-D value axes end at the data, and only the room limits the ticks', () => {
    const scale = (length: number) =>
      autoValueScale({
        dataMin: 0,
        dataMax: 5,
        lengthPt: length,
        minIntervalPt: 15,
        fixedMin: null,
        fixedMax: null,
        fixedMajor: null,
        noHeadroom: true,
        roomOnly: true,
      });
    expect(scale(150)).toMatchObject({ min: 0, max: 5, major: 0.5 });
    expect(scale(100)).toMatchObject({ min: 0, max: 5, major: 1 });
    // Room for twenty ticks still takes ten.
    expect(scale(1_000)).toMatchObject({ min: 0, max: 5, major: 0.5 });
  });

  test('an upright 3-D value axis keeps ticks 1.4 sizes apart, a flat one 1.6', () => {
    const info = (): ValueInfo => ({
      axis: null,
      id: '',
      dataMin: 0,
      dataMax: 5,
      percent: false,
      scale: null,
      formatCode: null,
    });
    const style = { ...DEFAULT_CHART_TEXT, sizePt: 10 };
    // 150 points hold ten intervals of 14 but only nine of 16.
    expect(scaleValues(info(), 150, true, style, false, true).major).toBe(0.5);
    expect(scaleValues(info(), 150, true, style, false, false).major).toBe(1);
  });
});

describe('3-D box', () => {
  test('a box with a series axis is as tall, for its width or depth if less, as its room', () => {
    expect(boxHeight(400, 300, 200, true)).toBeCloseTo(150, 6);
    expect(boxHeight(400, 600, 200, true)).toBeCloseTo(200, 6);
    expect(boxHeight(400, 300, 200, false)).toBeCloseTo(200, 6);
  });

  test('an eye distance on the page keeps the same perspective for any box size', () => {
    const near = (w: number) => {
      const projection = fitProjection(
        view({ rightAngles: false, perspective: 30 }),
        { w, h: w / 2, d: w },
        BOX,
        { eyePoints: 730 }
      );
      const edge = (z: number) =>
        projection.point({ x: 0, y: w / 2, z }).y - projection.point({ x: 0, y: 0, z }).y;
      return edge(0) / edge(w);
    };
    expect(near(1)).toBeCloseTo(near(1_000), 6);
    expect(near(1)).toBeGreaterThan(1.1);
  });
});

describe('3-D charts', () => {
  test('a clustered 3-D column chart paints boxes as deep as their bars are wide', () => {
    const plot =
      '<c:bar3DChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>' +
      series(0, 'Alpha', CATEGORIES, [4, 2, 3, 5]) +
      '<c:gapWidth val="150"/><c:shape val="box"/><c:axId val="1"/><c:axId val="2"/><c:axId val="0"/>' +
      '</c:bar3DChart>' +
      AXES_2;
    const projection = project(chart3D(plot, VIEW_RIGHT_ANGLES));
    expect(unsupported(projection)).toEqual([]);
    const components = projection.vectorShape!.components;
    const fronts = components.filter((component) => component.fillHex === '4472C4');
    const sides = components.filter((component) => component.fillHex === '2C497D');
    const tops = components.filter((component) => component.fillHex === '345795');
    expect(fronts).toHaveLength(4);
    expect(sides).toHaveLength(4);
    expect(tops).toHaveLength(4);
    const front = bounds(fronts[0]!.subpathsEmu[0]!);
    const side = bounds(sides[0]!.subpathsEmu[0]!);
    // Depth = width × depth percent, drawn at sin 20° across.
    expect(side.w / front.w).toBeCloseTo(Math.sin((20 * Math.PI) / 180), 2);
  });

  test('a 3-D column chart with a series axis puts each series in its own row', () => {
    const plot =
      '<c:bar3DChart><c:barDir val="col"/><c:grouping val="standard"/><c:varyColors val="0"/>' +
      series(0, 'Alpha', CATEGORIES, [4, 2, 3, 5]) +
      series(1, 'Beta', CATEGORIES, [1, 3, 2, 2]) +
      '<c:gapWidth val="150"/><c:shape val="box"/><c:axId val="1"/><c:axId val="2"/><c:axId val="3"/>' +
      '</c:bar3DChart>' +
      AXES_3;
    const projection = project(chart3D(plot, VIEW_PERSPECTIVE));
    expect(unsupported(projection)).toEqual([]);
    const placed = labels(projection);
    const alpha = placed.find((item) => item.text === 'Alpha')!;
    const beta = placed.find((item) => item.text === 'Beta')!;
    // Series labels run along the floor's right edge, the first series at the front.
    expect(alpha).toBeDefined();
    expect(beta.y).toBeLessThan(alpha.y);
    expect(beta.x).toBeGreaterThan(alpha.x);
    for (const category of CATEGORIES) expect(placed.map((item) => item.text)).toContain(category);
  });

  test('3-D line and area charts paint their series as ribbons and slabs', () => {
    for (const kind of ['line3DChart', 'area3DChart']) {
      const plot =
        `<c:${kind}><c:grouping val="standard"/><c:varyColors val="0"/>` +
        series(0, 'Alpha', CATEGORIES, [4, 2, 3, 5]) +
        `<c:axId val="1"/><c:axId val="2"/><c:axId val="3"/></c:${kind}>` +
        AXES_3;
      const projection = project(chart3D(plot, VIEW_PERSPECTIVE));
      expect(unsupported(projection)).toEqual([]);
      expect(projection.vectorShape!.components.length).toBeGreaterThan(3);
    }
  });

  test('a surface chart paints value bands and lists them in the legend, highest first', () => {
    const plot =
      '<c:surface3DChart><c:wireframe val="0"/>' +
      series(0, 'S1', ['A', 'B', 'C'], [1, 3, 1]) +
      series(1, 'S2', ['A', 'B', 'C'], [2, 8, 2]) +
      series(2, 'S3', ['A', 'B', 'C'], [1, 4, 1]) +
      '<c:axId val="1"/><c:axId val="2"/><c:axId val="3"/></c:surface3DChart>' +
      AXES_3;
    const projection = project(chart3D(plot, VIEW_PERSPECTIVE, 'r'));
    expect(unsupported(projection)).toEqual([]);
    const texts = labels(projection).map((item) => item.text);
    const bands = texts.filter((text) => /^\d+-\d+$/.test(text));
    expect(bands.length).toBeGreaterThan(1);
    expect(bands[0]).toBe(
      bands.slice().sort((a, b) => Number(b.split('-')[0]) - Number(a.split('-')[0]))[0]
    );
  });

  test('a contour chart sees the surface from above: the value labels share one place', () => {
    const plot =
      '<c:surfaceChart><c:wireframe val="0"/>' +
      series(0, 'S1', ['A', 'B', 'C'], [1, 3, 1]) +
      series(1, 'S2', ['A', 'B', 'C'], [2, 8, 2]) +
      '<c:axId val="1"/><c:axId val="2"/><c:axId val="3"/></c:surfaceChart>' +
      AXES_3.replace('<c:crossBetween val="between"/>', '<c:crossBetween val="midCat"/>');
    const projection = project(chart3D(plot, ''));
    expect(unsupported(projection)).toEqual([]);
    const values = labels(projection).filter((item) => /^\d+$/.test(item.text));
    expect(values.length).toBeGreaterThan(1);
    expect(new Set(values.map((item) => Math.round(item.y / 12_700))).size).toBe(1);
  });

  test('a surface grid past the point budget keeps the placeholder', () => {
    const many = Array.from({ length: 300 }, (_, index) => `C${index}`);
    let sers = '';
    for (let index = 0; index < 70; index += 1) {
      sers += series(
        index,
        `S${index}`,
        many,
        many.map((_, at) => (at * index) % 7)
      );
    }
    const plot =
      `<c:surface3DChart>${sers}<c:axId val="1"/><c:axId val="2"/><c:axId val="3"/></c:surface3DChart>` +
      AXES_3;
    const projection = project(chart3D(plot, VIEW_PERSPECTIVE));
    expect(projection.vectorShape).toBeNull();
    expect(unsupported(projection)).toHaveLength(1);
  });

  test('a 3-D pie paints a disc: tops in the slice colours and a darker rim', () => {
    const plot =
      '<c:pie3DChart><c:varyColors val="1"/><c:ser><c:idx val="0"/><c:order val="0"/>' +
      `<c:tx>${strCache(['Share'])}</c:tx><c:cat>${strCache(CATEGORIES)}</c:cat>` +
      `<c:val>${numCache([4, 3, 2, 1])}</c:val></c:ser></c:pie3DChart>`;
    const projection = project(
      chart3D(plot, '<c:view3D><c:rotX val="30"/><c:rotY val="0"/><c:rAngAx val="0"/></c:view3D>')
    );
    expect(unsupported(projection)).toEqual([]);
    const components = projection.vectorShape!.components;
    const tops = components.filter((component) =>
      ['4472C4', 'ED7D31', 'A5A5A5', 'FFC000'].includes(component.fillHex ?? '')
    );
    expect(tops).toHaveLength(4);
    // The disc is wider than tall: it is seen from 30° above.
    const top = bounds(tops.flatMap((component) => component.subpathsEmu[0]!));
    expect(top.h / top.w).toBeLessThan(0.6);
    expect(components.length).toBeGreaterThan(20);
  });
});

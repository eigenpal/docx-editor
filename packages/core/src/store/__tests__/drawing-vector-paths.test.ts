// The polygon reader for `a:custGeom` paths follows ECMA-376 Part 1, 20.1.9: only `a:moveTo`
// sets the current point, and `a:close` returns it to the start of the subpath. The geometry
// engine reads the same paths by the same rule.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlElement } from '../package/ooxml-tree.ts';
import { readShapePathPolygons } from '../package/drawing-vector-paths.ts';
import { customGeometryDefinition, evaluateGeometry } from '../package/drawing-geometry-engine.ts';

const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';

function pathElement(body: string): OoxmlElement {
  const result = readOoxmlPart(`<a:path xmlns:a="${A}">${body}</a:path>`, {
    name: '/word/geometry.xml',
    contentType: 'application/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part.root;
}

function read(body: string, budget = 1000) {
  const sink: { x: number; y: number }[][] = [];
  const closed: boolean[] = [];
  const ok = readShapePathPolygons(pathElement(body), 1, 1, sink, { remaining: budget }, closed);
  return { ok, subpaths: sink, closed };
}

function engine(body: string) {
  const root = readOoxmlPart(
    `<a:custGeom xmlns:a="${A}"><a:pathLst><a:path>${body}</a:path></a:pathLst></a:custGeom>`,
    { name: '/word/geometry.xml', contentType: 'application/xml' }
  );
  if (!root.ok) throw new Error(root.reason);
  const geometry = evaluateGeometry(customGeometryDefinition(root.part.root)!, 1000, 1000)!;
  return geometry.paths[0]!.subpaths.map((subpath) => ({
    points: subpath.points.map((point) => ({ x: point.x, y: point.y })),
    closed: subpath.closed,
  }));
}

const line = (x: number, y: number) => `<a:lnTo><a:pt x="${x}" y="${y}"/></a:lnTo>`;
const move = (x: number, y: number) => `<a:moveTo><a:pt x="${x}" y="${y}"/></a:moveTo>`;
const cubic =
  '<a:cubicBezTo><a:pt x="1" y="1"/><a:pt x="2" y="2"/><a:pt x="3" y="3"/></a:cubicBezTo>';

describe('custom geometry polygon reader', () => {
  test('lines and curves before the first moveTo draw nothing', () => {
    const triangle = `${line(100, 0)}${line(100, 100)}<a:close/>`;
    expect(read(triangle)).toEqual({ ok: true, subpaths: [], closed: [] });
    expect(engine(triangle)).toEqual([]);

    const leading = read(`${cubic}${line(9, 9)}<a:close/>${move(5, 5)}${line(6, 6)}`);
    expect(leading).toEqual({
      ok: true,
      subpaths: [
        [
          { x: 5, y: 5 },
          { x: 6, y: 6 },
        ],
      ],
      closed: [false],
    });
  });

  test('a line after close starts at the closed subpath start, as the engine does', () => {
    const body = `${move(10, 10)}${line(100, 10)}${line(100, 100)}<a:close/>${line(10, 100)}`;
    const polygons = read(body);
    expect(polygons.ok).toBe(true);
    expect(polygons.subpaths).toEqual([
      [
        { x: 10, y: 10 },
        { x: 100, y: 10 },
        { x: 100, y: 100 },
      ],
      [
        { x: 10, y: 10 },
        { x: 10, y: 100 },
      ],
    ]);
    expect(polygons.closed).toEqual([true, false]);
    expect(engine(body)).toEqual(
      polygons.subpaths.map((points, index) => ({ points, closed: polygons.closed[index] }))
    );
  });

  test('a cubic after close continues from the closed subpath start', () => {
    const polygons = read(`${move(0, 0)}${line(10, 0)}<a:close/>${cubic}`);
    expect(polygons.ok).toBe(true);
    expect(polygons.subpaths.length).toBe(2);
    expect(polygons.subpaths[1]![0]).toEqual({ x: 0, y: 0 });
    expect(polygons.subpaths[1]!.at(-1)).toEqual({ x: 3, y: 3 });
    expect(polygons.closed).toEqual([true, false]);
  });

  test('a malformed verb before the first moveTo still refuses', () => {
    expect(read('<a:lnTo/>').ok).toBe(false);
    expect(read('<a:cubicBezTo><a:pt x="1" y="1"/></a:cubicBezTo>').ok).toBe(false);
  });

  test('the reopened subpath start counts against the point budget', () => {
    // moveTo and lnTo use 2 points and close keeps the budget; the reopened start needs a third.
    expect(read(`${move(0, 0)}${line(1, 0)}<a:close/>${line(0, 1)}`, 3).ok).toBe(false);
    expect(read(`${move(0, 0)}${line(1, 0)}<a:close/>${line(0, 1)}`, 4).ok).toBe(true);
  });
});

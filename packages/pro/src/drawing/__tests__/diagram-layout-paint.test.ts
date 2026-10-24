/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Formatting a data point carries itself (`dgm:spPr` on a content point) in a SmartArt
// diagram laid out without its saved drawing: it paints the shapes that show the point.

import { describe, expect, test } from 'bun:test';
import { isElement } from '../../../../core/src/store/package/drawing-projection-walk.ts';
import { readOoxmlPart, type OoxmlElement } from '../../../../core/src/store/package/ooxml-tree.ts';
import { readDiagramModel } from '../diagram-layout-model.ts';
import { synthesizeDiagramDrawing } from '../diagram-layout-synthesis.ts';
import { loadLayoutFixtures } from './smartart-layout-harness.ts';

const fixtures = loadLayoutFixtures(
  new URL('./fixtures/smartart-layout-cases.json.gz', import.meta.url).pathname
);

function parse(xml: string): OoxmlElement {
  const read = readOoxmlPart(xml, { name: '/part.xml', contentType: 'application/xml' });
  if (!read.ok) throw new Error(read.reason);
  return read.part.root;
}

function attribute(element: OoxmlElement | undefined, name: string) {
  return element?.attributes.find((entry) => entry.localName === name)?.value;
}

function children(element: OoxmlElement, localName?: string): OoxmlElement[] {
  const out: OoxmlElement[] = [];
  for (const child of element.children) {
    if (isElement(child) && (localName === undefined || child.localName === localName)) {
      out.push(child);
    }
  }
  return out;
}

/** A copy of the data model with `spPr` markup set on the point `modelId`. */
function format(data: string, modelId: string, markup: string): string {
  const escaped = modelId.replace(/[{}-]/g, (character) => `\\${character}`);
  const pattern = new RegExp(
    `(<dgm:pt modelId="${escaped}"[^>]*>(?:<dgm:prSet[^>]*/>|<dgm:prSet[^>]*>.*?</dgm:prSet>))<dgm:spPr/>`,
    's'
  );
  if (!pattern.test(data)) throw new Error(`point ${modelId} has no empty spPr`);
  return data.replace(pattern, `$1<dgm:spPr>${markup}</dgm:spPr>`);
}

function lay(id: string, data: string) {
  const item = fixtures.cases.find((entry) => entry.id === id)!;
  const source = (key: 'layout' | 'style' | 'colors') => parse(fixtures.parts[item.parts[key]]!);
  const drawing = synthesizeDiagramDrawing(
    {
      dataModel: parse(data),
      layoutDef: source('layout'),
      styleDef: source('style'),
      colorsDef: source('colors'),
    },
    { cx: item.frame[0], cy: item.frame[1] }
  );
  if (!drawing) throw new Error(`case ${id} did not lay out`);
  const shapes = new Map<string, OoxmlElement>();
  const walk = (element: OoxmlElement) => {
    if (element.localName === 'sp') shapes.set(attribute(element, 'modelId') ?? '', element);
    for (const child of children(element)) walk(child);
  };
  walk(drawing);
  return shapes;
}

/** The colour of a shape's fill and of its outline, from its own `spPr`. */
function paint(shape: OoxmlElement | undefined) {
  const spPr = shape ? children(shape, 'spPr')[0] : undefined;
  const colour = (fill: OoxmlElement | undefined) =>
    fill ? attribute(children(fill, 'srgbClr')[0], 'val') : undefined;
  const fills = spPr
    ? children(spPr).filter((child) =>
        ['solidFill', 'noFill', 'gradFill'].includes(child.localName)
      )
    : [];
  const line = spPr ? children(spPr, 'ln')[0] : undefined;
  return {
    fills: fills.map((fill) => fill.localName),
    fill: colour(fills.find((fill) => fill.localName === 'solidFill')),
    line: line ? colour(children(line, 'solidFill')[0]) : undefined,
  };
}

const solid = (rgb: string) => `<a:solidFill><a:srgbClr val="${rgb}"/></a:solidFill>`;

describe('SmartArt data point formatting', () => {
  test('child text in a box of its own takes its child point’s fill, not its parent’s', () => {
    const id = 'mixed-short-3-vList5';
    const item = fixtures.cases.find((entry) => entry.id === id)!;
    const source = fixtures.parts[item.parts.data]!;
    const model = readDiagramModel(parse(source))!;
    const box = [...model.points.values()].find(
      (point) => attribute(point.prSet ?? undefined, 'presName') === 'descendantText'
    )!;
    const parent = attribute(box.prSet ?? undefined, 'presAssocID')!;
    const child = model.presOf.get(box.modelId)![0]!;
    const heading = [...model.points.values()].find(
      (point) =>
        attribute(point.prSet ?? undefined, 'presName') === 'parentText' &&
        attribute(point.prSet ?? undefined, 'presAssocID') === parent
    )!;
    let data = format(source, parent, solid('FF0000'));
    data = format(data, child, solid('0070C0'));
    const shapes = lay(id, data);
    expect(paint(shapes.get(box.modelId)).fill).toBe('0070C0');
    expect(paint(shapes.get(heading.modelId)).fill).toBe('FF0000');
  });

  test('a connector takes the line of the transition point it shows', () => {
    const id = 'mixed-short-4-hierarchy1';
    const item = fixtures.cases.find((entry) => entry.id === id)!;
    const source = fixtures.parts[item.parts.data]!;
    const model = readDiagramModel(parse(source))!;
    // The first connector that shows its transition point (the root's transition has none).
    const connector = [...model.points.values()].find((point) => {
      const assoc = attribute(point.prSet ?? undefined, 'presAssocID');
      return (
        point.type === 'pres' &&
        model.points.get(assoc ?? '')?.type === 'parTrans' &&
        (model.presOf.get(point.modelId) ?? []).includes(assoc!)
      );
    })!;
    const transition = model.points.get(attribute(connector.prSet ?? undefined, 'presAssocID')!)!;
    const data = format(source, transition.modelId, `<a:ln w="19050">${solid('00B050')}</a:ln>`);
    const drawn = paint(lay(id, data).get(connector.modelId));
    expect(drawn.line).toBe('00B050');
    // The connector's path keeps one empty fill.
    expect(drawn.fills).toEqual(['noFill']);
  });
});

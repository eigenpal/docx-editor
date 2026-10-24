/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The SmartArt layout engine against drawings Office saved for the same parts: each case
// lays out with its saved drawing hidden, and its shapes are scored by box, preset,
// rotation and font size. The floors below are the current scores per layout family; a
// change that lowers one is a regression, a change that raises one updates the table.

import { describe, expect, test } from 'bun:test';
import { projectDrawingsInPackage } from '../../../../core/src/store/package/drawing-projection.ts';
import { synthesizeDiagramDrawing } from '../diagram-layout-synthesis.ts';
import { isElement } from '../../../../core/src/store/package/drawing-projection-walk.ts';
import { readOoxmlPart, type OoxmlElement } from '../../../../core/src/store/package/ooxml-tree.ts';
import {
  drawingShapes,
  loadLayoutFixtures,
  scoreCase,
  type CaseScore,
} from './smartart-layout-harness.ts';
import { smartArtPackage } from '../../../../core/src/store/__tests__/smartart-fixture.ts';
import { installDrawing } from '../index.ts';

installDrawing();

const fixtures = loadLayoutFixtures(
  new URL('./fixtures/smartart-layout-cases.json.gz', import.meta.url).pathname
);

interface Floor {
  readonly boxes: number;
  readonly presets: number;
  readonly rotations: number;
  readonly fonts: number;
  readonly refused: number;
}

/** Shapes within tolerance per family, summed over its cases. */
const FLOORS: Readonly<Record<string, Floor>> = {
  hProcess9: { boxes: 21, presets: 21, rotations: 21, fonts: 16, refused: 0 },
  process1: { boxes: 25, presets: 25, rotations: 25, fonts: 15, refused: 0 },
  target3: { boxes: 36, presets: 36, rotations: 36, fonts: 24, refused: 0 },
  target2: { boxes: 36, presets: 36, rotations: 36, fonts: 36, refused: 0 },
  venn2: { boxes: 16, presets: 16, rotations: 16, fonts: 16, refused: 0 },
  lProcess2: { boxes: 36, presets: 36, rotations: 36, fonts: 36, refused: 0 },
  vList5: { boxes: 36, presets: 36, rotations: 36, fonts: 36, refused: 0 },
  equation1: { boxes: 40, presets: 40, rotations: 40, fonts: 24, refused: 0 },
  list1: { boxes: 24, presets: 24, rotations: 24, fonts: 12, refused: 0 },
  // One child-text size off: the composite's child box is 3 pt wider than saved.
  hList2: { boxes: 24, presets: 36, rotations: 36, fonts: 20, refused: 0 },
  pyramid1: { boxes: 28, presets: 28, rotations: 28, fonts: 28, refused: 0 },
  cycle2: { boxes: 32, presets: 32, rotations: 32, fonts: 16, refused: 0 },
  radial5: { boxes: 24, presets: 56, rotations: 56, fonts: 26, refused: 0 },
  default: { boxes: 16, presets: 16, rotations: 16, fonts: 16, refused: 0 },
  hierarchy1: { boxes: 131, presets: 131, rotations: 131, fonts: 46, refused: 0 },
  hierarchy2: { boxes: 44, presets: 44, rotations: 44, fonts: 24, refused: 0 },
  HalfCircleOrganizationChart: { boxes: 0, presets: 0, rotations: 0, fonts: 0, refused: 4 },
  HorizontalOrganizationChart: { boxes: 58, presets: 58, rotations: 58, fonts: 31, refused: 0 },
  NameandTitleOrganizationalChart: { boxes: 4, presets: 33, rotations: 33, fonts: 2, refused: 0 },
  vList2: { boxes: 50, presets: 51, rotations: 51, fonts: 51, refused: 0 },
  orgChart1: { boxes: 71, presets: 71, rotations: 71, fonts: 38, refused: 0 },
};

function totals(scores: readonly CaseScore[]) {
  return {
    boxes: scores.reduce((sum, score) => sum + score.boxes, 0),
    presets: scores.reduce((sum, score) => sum + score.presets, 0),
    rotations: scores.reduce((sum, score) => sum + score.rotations, 0),
    fonts: scores.reduce((sum, score) => sum + score.fonts, 0),
    refused: scores.filter((score) => score.synthesized === null).length,
  };
}

describe('SmartArt layout engine against saved drawings', () => {
  const byLayout = new Map<string, CaseScore[]>();
  for (const item of fixtures.cases) {
    const list = byLayout.get(item.layout) ?? [];
    list.push(scoreCase(fixtures, item));
    byLayout.set(item.layout, list);
  }

  test('every fixture family has a floor', () => {
    expect([...byLayout.keys()].sort()).toEqual(Object.keys(FLOORS).sort());
  });

  for (const [layout, floor] of Object.entries(FLOORS)) {
    test(`${layout} keeps its scores`, () => {
      const scores = byLayout.get(layout) ?? [];
      const got = totals(scores);
      expect(got.boxes).toBeGreaterThanOrEqual(floor.boxes);
      expect(got.presets).toBeGreaterThanOrEqual(floor.presets);
      expect(got.rotations).toBeGreaterThanOrEqual(floor.rotations);
      expect(got.fonts).toBeGreaterThanOrEqual(floor.fonts);
      expect(got.refused).toBeLessThanOrEqual(floor.refused);
    });
  }
});

describe('SmartArt without a saved drawing', () => {
  const item = fixtures.cases.find((entry) => entry.id === 'process-short-1-process1')!;
  const part = (key: 'data' | 'layout' | 'style' | 'colors') => fixtures.parts[item.parts[key]]!;

  test('lays the diagram out from its data, layout, style and colour parts', () => {
    const pkg = smartArtPackage({
      drawingRelationship: 'none',
      extent: [item.frame[0], item.frame[1]],
      dataPartXml: part('data'),
      layoutPartXml: part('layout'),
      stylePartXml: part('style'),
      colorsPartXml: part('colors'),
    });
    const [projection] = projectDrawingsInPackage(pkg);
    const vector = projection!.vectorShape!;
    // Three process steps and two arrows, each one shape.
    expect(vector.components.length).toBeGreaterThanOrEqual(5);
    const texts = projection!.groupTextboxes ?? [];
    expect(texts).toHaveLength(3);
    // The steps sit in a row across the frame, left to right.
    const lefts = texts.map((text) => text.frameEmu.x);
    expect([...lefts].sort((a, b) => a - b)).toEqual(lefts);
  });

  test('keeps the placeholder when the layout definition is missing', () => {
    const pkg = smartArtPackage({ drawingRelationship: 'none', dataPartXml: part('data') });
    const [projection] = projectDrawingsInPackage(pkg);
    expect(projection!.vectorShape ?? null).toBeNull();
  });
});

describe('SmartArt organization chart gates', () => {
  const lay = (id: string, edit: (data: string) => string = (data) => data) => {
    const item = fixtures.cases.find((entry) => entry.id === id)!;
    const parse = (xml: string) => {
      const read = readOoxmlPart(xml, { name: '/part.xml', contentType: 'application/xml' });
      if (!read.ok) throw new Error(read.reason);
      return read.part.root;
    };
    const source = (key: 'data' | 'layout' | 'style' | 'colors') =>
      fixtures.parts[item.parts[key]]!;
    return synthesizeDiagramDrawing(
      {
        dataModel: parse(edit(source('data'))),
        layoutDef: parse(source('layout')),
        styleDef: parse(source('style')),
        colorsDef: parse(source('colors')),
      },
      { cx: item.frame[0], cy: item.frame[1] }
    );
  };

  test('the half-circle organization chart keeps its placeholder', () => {
    expect(lay('halforg-short-1-HalfCircleOrganizationChart')).toBeNull();
  });

  test('a hierarchy whose branches inherit the standard style draws', () => {
    const drawing = lay('mixed-short-4-hierarchy1', (data) =>
      data.replace(
        /(presName="hierRoot\d" presStyleCnt="0")\/>/g,
        '$1><dgm:presLayoutVars><dgm:hierBranch val="init"/></dgm:presLayoutVars></dgm:prSet>'
      )
    );
    expect(drawing).not.toBeNull();
    expect(drawingShapes(drawing!)).toHaveLength(17);
  });
});

describe('SmartArt content formatting', () => {
  const item = fixtures.cases.find((entry) => entry.id === 'process-short-1-process1')!;
  const parse = (xml: string, name: string) => {
    const read = readOoxmlPart(xml, { name, contentType: 'application/xml' });
    if (!read.ok) throw new Error(read.reason);
    return read.part.root;
  };
  const source = (key: 'data' | 'layout' | 'style' | 'colors') => fixtures.parts[item.parts[key]]!;
  const FIRST = '<dgm:pt modelId="{5D1BADD1-48C5-464B-B01C-0FB5913DEEC9}">';
  const lay = (data: string) =>
    synthesizeDiagramDrawing(
      {
        dataModel: parse(data, '/data.xml'),
        layoutDef: parse(source('layout'), '/layout.xml'),
        styleDef: parse(source('style'), '/style.xml'),
        colorsDef: parse(source('colors'), '/colors.xml'),
      },
      { cx: item.frame[0], cy: item.frame[1] }
    )!;
  const find = (element: OoxmlElement, localName: string): OoxmlElement | null => {
    if (element.localName === localName) return element;
    for (const child of element.children) {
      if (!isElement(child)) continue;
      const found = find(child, localName);
      if (found) return found;
    }
    return null;
  };
  const attribute = (element: OoxmlElement | null, name: string) =>
    element?.attributes.find((entry) => entry.localName === name)?.value;

  test("a content point's own fill paints the shape that shows it", () => {
    const data = source('data').replace(
      `${FIRST}<dgm:prSet phldrT="[Text]"/><dgm:spPr/>`,
      `${FIRST}<dgm:prSet phldrT="[Text]"/><dgm:spPr><a:solidFill><a:srgbClr val="00B050"/></a:solidFill></dgm:spPr>`
    );
    const spPr = find(find(lay(data), 'sp')!, 'spPr')!;
    expect(attribute(find(find(spPr, 'solidFill')!, 'srgbClr'), 'val')).toBe('00B050');
  });

  test('custom text keeps its size and the margins follow it', () => {
    const data = source('data').replace(
      `${FIRST}<dgm:prSet phldrT="[Text]"/><dgm:spPr/><dgm:t><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"/>`,
      `${FIRST}<dgm:prSet phldrT="[Text]" custT="1"/><dgm:spPr/><dgm:t><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="1100"/>`
    );
    const drawing = lay(data);
    expect(drawingShapes(drawing)[0]!.fontSizes).toEqual([1100]);
    // 0.3 of 11 pt on each side, not 0.3 of the solved size.
    expect(attribute(find(find(drawing, 'sp')!, 'bodyPr'), 'lIns')).toBe('41910');
  });
});

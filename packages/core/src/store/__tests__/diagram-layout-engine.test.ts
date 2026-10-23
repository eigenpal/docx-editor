// The SmartArt layout engine against drawings Office saved for the same parts: each case
// lays out with its saved drawing hidden, and its shapes are scored by box, preset,
// rotation and font size. The floors below are the current scores per layout family; a
// change that lowers one is a regression, a change that raises one updates the table.

import { describe, expect, test } from 'bun:test';
import { projectDrawingsInPackage } from '../package/drawing-projection.ts';
import { loadLayoutFixtures, scoreCase, type CaseScore } from './smartart-layout-harness.ts';
import { smartArtPackage } from './smartart-fixture.ts';

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
  hProcess9: { boxes: 16, presets: 16, rotations: 16, fonts: 12, refused: 0 },
  process1: { boxes: 20, presets: 20, rotations: 20, fonts: 12, refused: 0 },
  target3: { boxes: 36, presets: 36, rotations: 36, fonts: 24, refused: 0 },
  target2: { boxes: 36, presets: 36, rotations: 36, fonts: 22, refused: 0 },
  venn2: { boxes: 16, presets: 16, rotations: 16, fonts: 12, refused: 0 },
  lProcess2: { boxes: 36, presets: 36, rotations: 36, fonts: 36, refused: 0 },
  vList5: { boxes: 32, presets: 32, rotations: 32, fonts: 29, refused: 0 },
  equation1: { boxes: 40, presets: 40, rotations: 40, fonts: 24, refused: 0 },
  list1: { boxes: 0, presets: 12, rotations: 12, fonts: 0, refused: 0 },
  hList2: { boxes: 0, presets: 24, rotations: 24, fonts: 5, refused: 0 },
  pyramid1: { boxes: 0, presets: 0, rotations: 0, fonts: 0, refused: 4 },
  cycle2: { boxes: 24, presets: 24, rotations: 24, fonts: 12, refused: 0 },
  radial5: { boxes: 24, presets: 56, rotations: 56, fonts: 21, refused: 0 },
  default: { boxes: 16, presets: 16, rotations: 16, fonts: 16, refused: 0 },
  hierarchy1: { boxes: 0, presets: 0, rotations: 0, fonts: 0, refused: 4 },
  hierarchy2: { boxes: 0, presets: 0, rotations: 0, fonts: 0, refused: 4 },
  HalfCircleOrganizationChart: { boxes: 0, presets: 0, rotations: 0, fonts: 0, refused: 4 },
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

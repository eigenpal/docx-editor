// Manifest-driven per-fixture oracles for Task 17 §7.1–7.9.

import { expect } from 'bun:test';
import type { DrawingProjection } from '../package/drawing-projection.ts';
import type { ImageResourceState } from '../package/image-resources.ts';
import type { SemanticLayout } from '../../layout/semantic-layout.ts';

export interface FixtureLayoutPaintOracle {
  readonly drawingCount: number;
  readonly pageCount: number;
  readonly readyCount: number;
  readonly placeholderCount: number;
  readonly assertProjections: (projections: readonly DrawingProjection[]) => void;
  readonly assertResourceKinds?: (kinds: readonly ImageResourceState['kind'][]) => void;
  readonly assertLayout?: (layout: SemanticLayout) => void;
}

export const FIXTURE_ORACLES: Readonly<Record<string, FixtureLayoutPaintOracle>> = {
  'comprehensive-word-element-test.docx': {
    drawingCount: 11,
    pageCount: 26,
    readyCount: 11,
    placeholderCount: 0,
    assertProjections: (projections) => {
      expectNames(projections, [
        'green',
        'red',
        'blue',
        'green',
        'orange',
        'banner',
        'float',
        'red',
        'blue',
        'green',
        'orange',
      ]);
      expect(projections.filter((p) => p.wrap === 'square')).toHaveLength(1);
      expect(projections.every((p) => p.picture?.crop.left === 0)).toBe(true);
    },
  },
  'list-pagination-break.docx': {
    drawingCount: 0,
    pageCount: 81,
    readyCount: 0,
    placeholderCount: 0,
    assertProjections: (projections) => {
      expect(projections).toHaveLength(0);
    },
  },
  'float-wrap-comprehensive-test.docx': {
    drawingCount: 26,
    pageCount: 7,
    readyCount: 26,
    placeholderCount: 0,
    assertProjections: (projections) => {
      expect(projections.some((p) => p.wrap === 'tight')).toBe(true);
      expect(projections.some((p) => p.wrap === 'through')).toBe(true);
      expect(projections.some((p) => p.wrap === 'topAndBottom')).toBe(true);
      expect(projections.some((p) => p.wrap === 'squareLeft')).toBe(true);
      expect(projections.some((p) => p.wrap === 'squareRight')).toBe(true);
      expect(projections.some((p) => p.wrap === 'behind')).toBe(true);
    },
  },
  'image-layout-modes-demo.docx': {
    drawingCount: 3,
    pageCount: 1,
    readyCount: 3,
    placeholderCount: 0,
    assertProjections: (projections) => {
      expect(projections.map((p) => p.wrap).sort()).toEqual(['inline', 'square', 'topAndBottom']);
    },
  },
  'issue-705-anchored-header-letterhead.docx': {
    drawingCount: 0,
    pageCount: 1,
    readyCount: 0,
    placeholderCount: 0,
    assertProjections: (projections) => {
      expect(projections).toHaveLength(0);
    },
  },
  'wrap-none-positioned-image-demo.docx': {
    drawingCount: 1,
    pageCount: 1,
    readyCount: 1,
    placeholderCount: 0,
    assertProjections: (projections) => {
      expect(projections[0]!.wrap).toBe('inFront');
      expect(projections[0]!.anchor?.behindDocument).toBe(false);
    },
  },
  'images-external.docx': {
    drawingCount: 4,
    pageCount: 3,
    readyCount: 4,
    placeholderCount: 0,
    assertProjections: (projections) => {
      expect(projections).toHaveLength(4);
    },
    assertResourceKinds: (kinds) => {
      expect(kinds.filter((kind) => kind === 'external')).toHaveLength(2);
      expect(kinds).toContain('unrenderable');
      expect(kinds).toContain('ready');
    },
  },
  'images-wrap-sides.docx': {
    drawingCount: 9,
    pageCount: 1,
    readyCount: 9,
    placeholderCount: 0,
    assertProjections: (projections) => {
      expect(projections.map((p) => p.wrap).sort()).toEqual(
        [
          'behind',
          'inFront',
          'square',
          'square',
          'squareLeft',
          'squareRight',
          'through',
          'tight',
          'topAndBottom',
        ].sort()
      );
    },
  },
  'images-crop.docx': {
    drawingCount: 1,
    pageCount: 1,
    readyCount: 1,
    placeholderCount: 0,
    assertProjections: (projections) => {
      expect(projections[0]!.picture?.crop).toEqual({
        left: 0.1,
        top: 0.15,
        right: 0.2,
        bottom: 0.25,
      });
    },
  },
  'images-zorder.docx': {
    drawingCount: 2,
    pageCount: 1,
    readyCount: 2,
    placeholderCount: 0,
    assertProjections: (projections) => {
      const behind = projections.find((p) => p.name === 'behind');
      const front = projections.find((p) => p.name === 'front');
      expect(behind?.anchor?.behindDocument).toBe(true);
      expect(behind?.anchor?.relativeHeight).toBe(100);
      expect(behind?.anchor?.allowOverlap).toBe(false);
      expect(front?.anchor?.behindDocument).toBe(false);
      expect(front?.anchor?.relativeHeight).toBe(200);
      expect(front?.anchor?.allowOverlap).toBe(false);
    },
  },
  'images-formats.docx': {
    drawingCount: 7,
    pageCount: 1,
    readyCount: 7,
    placeholderCount: 0,
    assertProjections: (projections) => {
      expectNames(projections, ['png', 'jpeg', 'gif', 'svg', 'tif', 'emf', 'wmf']);
    },
    assertResourceKinds: (kinds) => {
      expect(kinds.filter((kind) => kind === 'ready')).toHaveLength(3);
      expect(kinds.filter((kind) => kind === 'unrenderable')).toHaveLength(4);
    },
  },
  'images-header.docx': {
    drawingCount: 1,
    pageCount: 1,
    readyCount: 0,
    placeholderCount: 0,
    assertProjections: (projections) => {
      expect(projections[0]!.wrap).toBe('inFront');
      expect(projections[0]!.ownerPartName).toBe('/word/header1.xml');
    },
  },
  'images-nonpicture.docx': {
    drawingCount: 3,
    pageCount: 1,
    readyCount: 3,
    placeholderCount: 0,
    assertProjections: (projections) => {
      expectNames(projections, ['chart', 'group', 'textbox']);
      expect(projections.every((p) => p.picture === null)).toBe(true);
      expect(
        projections.flatMap((p) => p.diagnostics).filter((d) => d.code === 'unsupported-graphic')
      ).toHaveLength(3);
    },
  },
  'images-transform.docx': {
    drawingCount: 3,
    pageCount: 1,
    readyCount: 3,
    placeholderCount: 0,
    assertProjections: (projections) => {
      const rot90 = projections.find((p) => p.name === 'rot90');
      const flipH = projections.find((p) => p.name === 'flipH');
      const flipV = projections.find((p) => p.name === 'flipV');
      expect(rot90?.picture?.transform.rotationDegrees).toBe(90);
      expect(flipH?.picture?.transform.flipHorizontal).toBe(true);
      expect(flipV?.picture?.transform.flipVertical).toBe(true);
    },
  },
  'images-compatibility-malformed.docx': {
    drawingCount: 1,
    pageCount: 1,
    readyCount: 1,
    placeholderCount: 0,
    assertProjections: (projections) => {
      expect(projections).toHaveLength(1);
    },
  },
  'images-drawingml-watermark.docx': {
    drawingCount: 1,
    pageCount: 1,
    readyCount: 1,
    placeholderCount: 0,
    assertProjections: (projections) => {
      expect(projections.some((p) => p.effects.grayscale === true)).toBe(true);
      expect(projections[0]!.wrap).toBe('behind');
    },
  },
};

function expectNames(projections: readonly DrawingProjection[], names: readonly string[]): void {
  expect(projections.map((p) => p.name)).toEqual(names);
}

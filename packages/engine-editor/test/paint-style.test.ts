// Shared paint helpers (comprehensive 4.6): both adapters read styling from here so a bold 24px run
// paints identically in React and Vue, hex fills are valid CSS, and borders have paintable boxes.

import { describe, expect, test } from 'bun:test';
import { colorToCss, runStyle, borderSegLine } from '../src/paint-style.ts';
import type { GlyphRun, BorderSeg } from '@docx-editor.dev/core-contract/contracts/geometry';

describe('colorToCss', () => {
  test("hex is '#'-prefixed (a bare 'RRGGBB' is not valid CSS)", () => {
    expect(colorToCss({ kind: 'hex', value: 'DDDDDD' })).toBe('#DDDDDD');
    expect(colorToCss({ kind: 'hex', value: '#112233' })).toBe('#112233'); // idempotent on a leading #
  });
  test('auto and theme inherit (undefined) rather than emit an invalid color', () => {
    expect(colorToCss({ kind: 'auto' })).toBeUndefined();
    expect(colorToCss({ kind: 'theme', slot: 'accent1' })).toBeUndefined();
  });
});

describe('runStyle', () => {
  test('carries the run typography the paint used to drop (incl. underline + strike)', () => {
    const run: GlyphRun = {
      text: 'x',
      box: { x: 0, y: 0, width: 10, height: 20 },
      fontFamily: 'Georgia',
      fontSizePx: 24,
      fontWeight: 700,
      fontStyle: 'italic',
      color: { kind: 'hex', value: '223344' },
      direction: 'rtl',
      shaping: { features: [] },
      bold: true,
      italic: true,
      underline: true,
      strike: true,
    };
    expect(runStyle(run, 'DocxFont_exact_face')).toEqual({
      fontFamily: 'DocxFont_exact_face',
      fontSizePx: 24,
      color: '#223344',
      fontWeight: 700,
      fontStyle: 'italic',
      textDecoration: 'underline line-through',
      direction: 'rtl',
      widthPx: 10,
      heightPx: 20,
      fontFeatureSettings: undefined,
    });
  });
  test('no decorations -> undefined textDecoration', () => {
    const run: GlyphRun = {
      text: 'x',
      box: { x: 0, y: 0, width: 1, height: 1 },
      fontFamily: 'A',
      fontSizePx: 10,
      fontWeight: 400,
      fontStyle: 'normal',
      color: { kind: 'auto' },
      direction: 'ltr',
      shaping: { features: [] },
      bold: false,
      italic: false,
    };
    expect(runStyle(run, 'DocxFont_exact_face').textDecoration).toBeUndefined();
  });
});

describe('borderSegLine', () => {
  test('a horizontal segment is a horizontal line honoring its CSS style', () => {
    const seg: BorderSeg = {
      from: { x: 10, y: 5 },
      to: { x: 110, y: 5 },
      widthPx: 2,
      color: { kind: 'hex', value: '000000' },
      style: 'dashed',
    };
    expect(borderSegLine(seg)).toEqual({
      x: 10,
      y: 5,
      length: 100,
      horizontal: true,
      widthPx: 2,
      color: '#000000',
      cssStyle: 'dashed',
    });
  });
  test("a vertical 'single' segment maps to CSS 'solid'", () => {
    const seg: BorderSeg = {
      from: { x: 10, y: 5 },
      to: { x: 10, y: 55 },
      widthPx: 1,
      color: { kind: 'hex', value: '000000' },
      style: 'single',
    };
    expect(borderSegLine(seg)).toEqual({
      x: 10,
      y: 5,
      length: 50,
      horizontal: false,
      widthPx: 1,
      color: '#000000',
      cssStyle: 'solid',
    });
  });
});

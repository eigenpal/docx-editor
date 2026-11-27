/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import type { FontkitFont, FontkitGlyph } from 'fontkit';
import { colorGlyph } from '../src/color-glyphs.ts';
import { Work } from '../src/context.ts';

const square: FontkitGlyph = {
  advanceWidth: 512,
  path: {
    commands: [
      { command: 'moveTo', args: [0, 0] },
      { command: 'lineTo', args: [512, 0] },
      { command: 'quadraticCurveTo', args: [512, 512, 0, 512] },
      { command: 'closePath', args: [] },
    ],
  },
};

type Color = { red: number; green: number; blue: number; alpha: number };

/**
 * A color face whose glyph 1 has the given layers, as COLR v0 and CPAL records. Glyph ids
 * from 10 up are the layer outlines; `glyphs` overrides any glyph by id.
 */
function font(
  layers: readonly { glyph: FontkitGlyph; color: Color | 'foreground' }[],
  glyphs: Record<number, FontkitGlyph> = {}
): FontkitFont {
  const colors = layers.flatMap((layer) => (layer.color === 'foreground' ? [] : [layer.color]));
  let next = 0;
  return {
    COLR: {
      numLayerRecords: layers.length,
      baseGlyphRecord: layers.length
        ? [{ gid: 1, firstLayerIndex: 0, numLayers: layers.length }]
        : [],
      layerRecords: layers.map((layer, index) => ({
        gid: 10 + index,
        paletteIndex: layer.color === 'foreground' ? 0xffff : next++,
      })),
    },
    CPAL: { numColorRecords: colors.length, colorRecordIndices: [0], colorRecords: colors },
    getGlyph: (id: number) =>
      glyphs[id] ?? layers[id - 10]?.glyph ?? { advanceWidth: 512, path: { commands: [] } },
  } as unknown as FontkitFont;
}

const black = { red: 0, green: 0, blue: 0, alpha: 255 };

test('layers carry their palette color and alpha, with quadratics as cubics', () => {
  const work = new Work(new AbortController().signal);
  const glyph = colorGlyph(
    font([
      { glyph: square, color: { red: 119, green: 178, blue: 85, alpha: 255 } },
      { glyph: square, color: { red: 0, green: 0, blue: 0, alpha: 128 } },
      { glyph: square, color: 'foreground' },
    ]),
    1,
    work
  );
  expect(glyph.kind).toBe('layers');
  if (glyph.kind !== 'layers') return;
  expect(glyph.layers[0]!.fill).toBe('0.466667 0.698039 0.333333 rg');
  expect(glyph.layers[0]!.alpha).toBe(1);
  expect(glyph.layers[1]!.alpha).toBeCloseTo(128 / 255, 6);
  // Palette index 0xFFFF takes the text color, which the writer supplies.
  expect(glyph.layers[2]).toMatchObject({ fill: null, alpha: 1 });
  expect(glyph.layers[0]!.path).toBe('0 0 m 512 0 l 512 341.333333 341.333333 512 0 512 c h');
});

test('a glyph without a base glyph record is monochrome, and bounds are refusals', () => {
  const work = new Work(new AbortController().signal);
  // Glyph 2 has an outline and no record: the writer writes it as text.
  expect(colorGlyph(font([{ glyph: square, color: black }], { 2: square }), 2, work)).toEqual({
    kind: 'none',
  });
  const tooMany = Array.from({ length: 257 }, () => ({ glyph: square, color: black }));
  expect(colorGlyph(font(tooMany), 1, work).kind).toBe('refused');
  const bad = {
    ...square,
    path: { commands: [{ command: 'moveTo' as const, args: [Number.NaN, 0] }] },
  };
  expect(colorGlyph(font([{ glyph: bad, color: black }]), 1, work).kind).toBe('refused');
  // Records that point past the layer or palette arrays are refused, not read.
  const outOfRange = font([{ glyph: square, color: black }]) as unknown as {
    COLR: { baseGlyphRecord: { numLayers: number }[] };
    CPAL: { colorRecordIndices: number[] };
  };
  outOfRange.COLR.baseGlyphRecord[0]!.numLayers = 2;
  expect(colorGlyph(outOfRange as unknown as FontkitFont, 1, work).kind).toBe('refused');
  const pastPalette = font([{ glyph: square, color: black }]) as unknown as {
    CPAL: { colorRecordIndices: number[] };
  };
  pastPalette.CPAL.colorRecordIndices[0] = 1;
  expect(colorGlyph(pastPalette as unknown as FontkitFont, 1, work).kind).toBe('refused');
  // A face without color tables has no color glyphs at all.
  expect(colorGlyph({ getGlyph: () => square } as unknown as FontkitFont, 5, work)).toEqual({
    kind: 'none',
  });
});

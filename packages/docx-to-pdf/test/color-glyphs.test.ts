/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
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

function font(glyph: Partial<FontkitGlyph>): FontkitFont {
  return {
    COLR: {},
    CPAL: {},
    getGlyph: () => ({ advanceWidth: 512, path: { commands: [] }, ...glyph }),
  } as unknown as FontkitFont;
}

test('layers carry their palette color and alpha, with quadratics as cubics', () => {
  const work = new Work(new AbortController().signal);
  const glyph = colorGlyph(
    font({
      layers: [
        { glyph: square, color: { red: 119, green: 178, blue: 85, alpha: 255 } },
        { glyph: square, color: { red: 0, green: 0, blue: 0, alpha: 128 } },
      ],
    }),
    1,
    work
  );
  expect(glyph.kind).toBe('layers');
  if (glyph.kind !== 'layers') return;
  expect(glyph.layers[0]!.fill).toBe('0.466667 0.698039 0.333333 rg');
  expect(glyph.layers[0]!.alpha).toBe(1);
  expect(glyph.layers[1]!.alpha).toBeCloseTo(128 / 255, 6);
  expect(glyph.layers[0]!.path).toBe('0 0 m 512 0 l 512 341.333333 341.333333 512 0 512 c h');
});

test('a glyph without layers says whether it has an outline, and bounds are refusals', () => {
  const work = new Work(new AbortController().signal);
  expect(colorGlyph(font({}), 1, work)).toEqual({ kind: 'none', outlined: false });
  expect(colorGlyph(font({ path: square.path }), 2, work)).toEqual({
    kind: 'none',
    outlined: true,
  });
  const tooMany = Array.from({ length: 257 }, () => ({
    glyph: square,
    color: { red: 0, green: 0, blue: 0, alpha: 255 },
  }));
  expect(colorGlyph(font({ layers: tooMany }), 3, work).kind).toBe('refused');
  const bad = {
    ...square,
    path: { commands: [{ command: 'moveTo' as const, args: [Number.NaN, 0] }] },
  };
  expect(
    colorGlyph(
      font({ layers: [{ glyph: bad, color: { red: 0, green: 0, blue: 0, alpha: 255 } }] }),
      4,
      work
    ).kind
  ).toBe('refused');
  // A face without color tables has no color glyphs at all.
  expect(colorGlyph({ getGlyph: () => square } as unknown as FontkitFont, 5, work)).toEqual({
    kind: 'none',
    outlined: true,
  });
});

/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
declare module 'fontkit' {
  export interface FontkitFont {
    readonly underlinePosition: number;
    readonly underlineThickness: number;
    readonly unitsPerEm: number;
    readonly ascent: number;
    readonly descent: number;
    readonly lineGap: number;
    readonly capHeight: number;
    readonly italicAngle: number;
    readonly bbox: { minX: number; minY: number; maxX: number; maxY: number };
    readonly variationAxes: Record<string, unknown>;
    readonly numGlyphs: number;
    getGlyph(id: number): FontkitGlyph;
    glyphForCodePoint(codePoint: number): FontkitGlyph & { readonly id: number };
    /** Present on a COLR/CPAL color font; its glyphs then carry {@link FontkitGlyph.layers}. */
    readonly COLR?: unknown;
    readonly CPAL?: unknown;
    createSubset(): { includeGlyph(id: number): number; encode(): Uint8Array };
    hasGlyphForCodePoint(codePoint: number): boolean;
    readonly postscriptName?: string | Uint8Array;
  }

  export interface FontkitPathCommand {
    readonly command: 'moveTo' | 'lineTo' | 'quadraticCurveTo' | 'bezierCurveTo' | 'closePath';
    readonly args: readonly number[];
  }

  export interface FontkitGlyph {
    readonly advanceWidth: number;
    readonly path: { readonly commands: readonly FontkitPathCommand[] };
    /** COLR v0 layers, bottom first, each with its CPAL palette color; only on a color font. */
    readonly layers?: readonly {
      readonly glyph: FontkitGlyph;
      readonly color: { red: number; green: number; blue: number; alpha: number };
    }[];
  }

  export interface FontkitCollection {
    readonly fonts: readonly FontkitFont[];
    getFont(postscriptName: string): FontkitFont | null;
  }

  export function create(buffer: Uint8Array | Buffer): FontkitFont | FontkitCollection;
  export function create(buffer: Uint8Array | Buffer, postscriptName: string): FontkitFont | null;
}

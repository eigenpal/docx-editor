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
    readonly capHeight: number;
    readonly italicAngle: number;
    readonly bbox: { minX: number; minY: number; maxX: number; maxY: number };
    readonly variationAxes: Record<string, unknown>;
    readonly numGlyphs: number;
    getGlyph(id: number): { advanceWidth: number };
    createSubset(): { includeGlyph(id: number): number; encode(): Uint8Array };
    hasGlyphForCodePoint(codePoint: number): boolean;
    readonly postscriptName?: string | Uint8Array;
  }

  export interface FontkitCollection {
    readonly fonts: readonly FontkitFont[];
    getFont(postscriptName: string): FontkitFont | null;
  }

  export function create(buffer: Uint8Array | Buffer): FontkitFont | FontkitCollection;
  export function create(buffer: Uint8Array | Buffer, postscriptName: string): FontkitFont | null;
}

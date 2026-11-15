/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Bitmaps in replay: their place in the drawing order, the window in force at their record,
// top-down source rows, and EMF+ encoded images.

import { describe, expect, test } from 'bun:test';
import { inflateSync } from 'node:zlib';
import type { MetafileCommand, MetafileRaster } from '@docx-editor.dev/core/store';
import { replayMetafile } from '../metafile-replay.ts';
import { colorWords, dibWords, replayWithoutDom, wmf, type WmfRecord } from './metafile-fixture.ts';

import { emfWithBitmap } from './metafile-encoded-bitmap-fixture.ts';

replayWithoutDom();

type Rgb = [number, number, number];
const RED: Rgb = [255, 0, 0];
const BLUE: Rgb = [0, 0, 255];
const measureText = (text: string, font: { sizePx: number }) => text.length * font.sizePx * 0.5;

/** META_STRETCHDIB with SRCCOPY: source (x, y, w, h) into target (x, y, w, h). */
function stretchDib(
  source: readonly [number, number, number, number],
  target: readonly [number, number, number, number],
  dib: readonly number[]
): WmfRecord {
  const [sx, sy, sw, sh] = source;
  const [tx, ty, tw, th] = target;
  return { fn: 0x0f43, words: [0x0020, 0x00cc, 0, sh, sw, sy, sx, th, tw, ty, tx, ...dib] };
}

/** A solid brush selected into slot `slot`. */
function brush(rgb: Rgb, slot: number): WmfRecord[] {
  return [
    { fn: 0x02fc, words: [0, ...colorWords(...rgb), 0] },
    { fn: 0x012d, words: [slot] },
  ];
}

/** META_RECTANGLE (left, top, right, bottom). */
const rectangle = (l: number, t: number, r: number, b: number): WmfRecord => ({
  fn: 0x041b,
  words: [b, r, t, l],
});

function images(commands: readonly MetafileCommand[]) {
  return commands.flatMap((command) => (command.kind === 'image' ? [command] : []));
}

describe('WMF bitmaps', () => {
  test('a bitmap paints over the drawing before its record and under the drawing after', async () => {
    const bytes = wmf(200, 100, [
      { fn: 0x020b, words: [0, 0] },
      { fn: 0x020c, words: [100, 200] },
      ...brush([255, 255, 255], 0),
      rectangle(0, 0, 200, 100),
      stretchDib([0, 0, 1, 1], [20, 10, 100, 50], dibWords([[RED]])),
      ...brush(BLUE, 1),
      rectangle(150, 60, 190, 90),
    ]);
    const replay = await replayMetafile(bytes, 'image/x-wmf', { textAdvance: measureText });
    const commands = replay!.drawing.commands;
    const kinds = commands.map((command) =>
      command.kind === 'fill'
        ? `fill ${command.paint.b === 255 && command.paint.r === 0 ? 'blue' : 'white'}`
        : command.kind
    );
    const image = kinds.indexOf('image');
    expect(image).toBeGreaterThan(kinds.indexOf('fill white'));
    expect(image).toBeLessThan(kinds.indexOf('fill blue'));
    expect(commands.some((command) => command.kind === 'text')).toBe(false);
  });

  test('a bitmap is placed in the window in force at its record', async () => {
    const bytes = wmf(200, 100, [
      { fn: 0x020b, words: [0, 0] },
      { fn: 0x020c, words: [100, 200] },
      stretchDib([0, 0, 1, 1], [0, 0, 100, 50], dibWords([[RED]])),
      { fn: 0x020b, words: [1000, 1000] },
    ]);
    const replay = await replayMetafile(bytes, 'image/x-wmf', { textAdvance: measureText });
    const scale = replay!.drawing.width / 200;
    const [image] = images(replay!.drawing.commands);
    const matrix = image!.matrix.map((value) => value / scale);
    [100, 0, 0, 50, 0, 0].forEach((value, index) => expect(matrix[index]!).toBeCloseTo(value, 0));
  });

  test('a partial blit of a top-down DIB counts source rows from the top', async () => {
    // dibWords stores its first row at the bottom; reversed and with a negative height, the
    // stored rows read top first: red over blue.
    const dib = dibWords([[BLUE], [RED]]);
    dib[4] = -2 & 0xffff;
    dib[5] = 0xffff;
    const bytes = wmf(100, 100, [
      { fn: 0x020b, words: [0, 0] },
      { fn: 0x020c, words: [100, 100] },
      // The top source row into (0, 40, 100, 20).
      stretchDib([0, 0, 1, 1], [0, 40, 100, 20], dib),
    ]);
    const replay = await replayMetafile(bytes, 'image/x-wmf', { textAdvance: measureText });
    const [image] = images(replay!.drawing.commands);
    expect(image).toBeDefined();
    expect(topLeftPixel(image!.raster)).toEqual([255, 0, 0, 255]);
  });
});

/** The top-left pixel of an encoded PNG or an RGBA raster. */
function topLeftPixel(raster: MetafileRaster): number[] {
  if (raster.kind === 'rgba') return Array.from(raster.data.slice(0, 4));
  const view = new DataView(raster.bytes.buffer, raster.bytes.byteOffset, raster.bytes.byteLength);
  const parts: Uint8Array[] = [];
  let colorType = 6;
  for (let at = 8; at + 12 <= raster.bytes.length;) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...raster.bytes.subarray(at + 4, at + 8));
    if (type === 'IHDR') colorType = raster.bytes[at + 17]!;
    if (type === 'IDAT') parts.push(raster.bytes.subarray(at + 8, at + 8 + length));
    at += 12 + length;
  }
  const joined = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.length;
  }
  // Every row filter predicts the first pixel of the first row from zeros, so its bytes after
  // the filter byte are the pixel itself.
  const row = inflateSync(joined);
  return colorType === 2 ? [...row.subarray(1, 4), 255] : Array.from(row.subarray(1, 5));
}

/** A complete 2 × 2 PNG of opaque red pixels. */
const RED_PNG = new Uint8Array([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 2, 0, 0, 0, 2, 8, 6, 0, 0,
  0, 114, 182, 13, 36, 0, 0, 0, 17, 73, 68, 65, 84, 120, 156, 99, 248, 207, 192, 240, 31, 132, 25,
  96, 12, 0, 71, 202, 7, 249, 103, 89, 110, 183, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
]);

/** A PNG signature and header declaring `w` × `h`, with no image data. */
function pngHeader(w: number, h: number): Uint8Array {
  const png = new Uint8Array(24);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(png.buffer).setUint32(16, w);
  new DataView(png.buffer).setUint32(20, h);
  return png;
}

describe('EMF+ encoded images', () => {
  test('a PNG within the pixel bound is drawn', async () => {
    const replay = await replayMetafile(emfWithBitmap(RED_PNG, 2, 2), 'image/x-emf', {
      textAdvance: measureText,
    });
    expect(replay?.complete).toBe(true);
    const [image] = images(replay!.drawing.commands);
    expect(image?.raster).toMatchObject({ kind: 'encoded', width: 2, height: 2 });
  });

  test('a PNG declaring more pixels than the bound is refused', async () => {
    const replay = await replayMetafile(
      emfWithBitmap(pngHeader(50_000, 50_000), 50_000, 50_000),
      'image/x-emf',
      {
        textAdvance: measureText,
      }
    );
    expect(images(replay?.drawing.commands ?? [])).toEqual([]);
  });
});

/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A GIF picture embeds as the PNG of its first frame, its transparent colour kept as alpha.
import { expect, test } from 'bun:test';
import { inflateSync } from 'node:zlib';
import { gifToPng } from '../src/gif-png.ts';

// 3×2: red, green, transparent / white, transparent, red.
const GIF = Uint8Array.from(
  atob('R0lGODlhAwACAIEAAP///wD/AP8AAAAAgCH5BAEAAAMALAAAAAADAAIAAAgJAAUEGABggICAADs='),
  (c) => c.charCodeAt(0)
);

/** The RGBA rows of an 8-bit RGBA PNG written with filter 0. */
function pixels(png: Uint8Array): number[][] {
  const view = new DataView(png.buffer, png.byteOffset);
  const width = view.getUint32(16);
  let at = 8;
  const data: Uint8Array[] = [];
  while (at < png.length) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
    if (type === 'IDAT') data.push(png.subarray(at + 8, at + 8 + length));
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(data));
  const rows: number[][] = [];
  for (let y = 0; y * (1 + width * 4) < raw.length; y++) {
    const start = y * (1 + width * 4) + 1;
    rows.push([...raw.subarray(start, start + width * 4)]);
  }
  return rows;
}

test('a GIF converts to PNG pixels with its transparent colour as alpha', () => {
  const png = gifToPng(GIF)!;
  expect(png).not.toBeNull();
  const [top, bottom] = pixels(png);
  expect(top!.slice(0, 8)).toEqual([255, 0, 0, 255, 0, 255, 0, 255]);
  expect(top![11]).toBe(0);
  expect(bottom!.slice(0, 4)).toEqual([255, 255, 255, 255]);
  expect(bottom![7]).toBe(0);
});

test('bytes that are not a readable GIF give null', () => {
  expect(gifToPng(new Uint8Array([1, 2, 3]))).toBeNull();
  expect(gifToPng(GIF.slice(0, 20))).toBeNull();
  // A frame larger than its screen is refused before anything is decoded.
  const narrow = GIF.slice();
  narrow[6] = 1;
  expect(gifToPng(narrow)).toBeNull();
});

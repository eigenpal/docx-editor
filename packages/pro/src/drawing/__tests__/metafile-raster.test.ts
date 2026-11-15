/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Exercise the installed converter with synthetic metafiles and its software canvas.
// No module mocks: a serial test run keeps the converter's real exports.

import { describe, expect, test } from 'bun:test';
import { inflateSync } from 'node:zlib';
import { metafileRenderer } from '../metafile-renderer.ts';
import { emf, replayWithoutDom, wmf } from './metafile-fixture.ts';
import { emfWithBitmap } from './metafile-encoded-bitmap-fixture.ts';
import { baselineRgbTiff } from '../../../../core/src/store/__tests__/tiff-test-bytes.ts';
import { convertBrowserMetafile } from '../../../../core/src/editor/browser-image-decode-port.ts';
import {
  drawingRenderers,
  installDrawingRenderers,
} from '../../../../core/src/store/package/drawing-renderers.ts';
import { resolveImageResourceLimits } from '../../../../core/src/store/runtime/limits.ts';

replayWithoutDom();

const convert = (bytes: Uint8Array, mime: 'image/x-emf' | 'image/x-wmf', maxEdge = 4096) =>
  metafileRenderer.rasterize!(bytes, mime, { maxEdge });

function dimensions(bytes: Uint8Array): readonly [number, number] {
  expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return [view.getUint32(16), view.getUint32(20)];
}

/** The first PNG pixel has no earlier pixel for its row filter to predict from. */
function firstPixel(bytes: Uint8Array): number[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks: Uint8Array[] = [];
  expect(bytes[24]).toBe(8);
  expect([2, 6]).toContain(bytes[25]);
  for (let at = 8; at + 12 <= bytes.length;) {
    const size = view.getUint32(at);
    if (view.getUint32(at + 4) === 0x49444154) chunks.push(bytes.subarray(at + 8, at + 8 + size));
    at += size + 12;
  }
  const row = inflateSync(Buffer.concat(chunks));
  return bytes[25] === 2 ? [...row.subarray(1, 4), 255] : [...row.subarray(1, 5)];
}

describe('metafile raster bounds', () => {
  test('small EMF and WMF drawings render at fourfold resolution', async () => {
    for (const [bytes, mime, size] of [
      [emf([0, 0, 100, 50], []), 'image/x-emf', [404, 204]],
      [wmf(100, 50, []), 'image/x-wmf', [400, 200]],
    ] as const) {
      const raster = await convert(bytes, mime);
      expect(raster).not.toBeNull();
      expect(dimensions(raster!.bytes)).toEqual(size);
    }
  });

  test('large recordings fit the target and retain their aspect ratio', async () => {
    const raster = await convert(emf([0, 0, 8192, 4096], []), 'image/x-emf');
    expect(raster).not.toBeNull();
    expect(dimensions(raster!.bytes)).toEqual([2048, 1024]);
  });

  test('a caller can request a smaller bound', async () => {
    const raster = await convert(emf([0, 0, 8192, 4096], []), 'image/x-emf', 256);
    expect(raster).not.toBeNull();
    expect(dimensions(raster!.bytes)).toEqual([256, 128]);
  });

  test('extreme recording bounds never become canvas dimensions', async () => {
    const bytes = emf([0, 0, 2_000_000_000, 1_000_000_000], []);
    // Omit the physical frame so the converter takes the extreme device bounds.
    bytes.fill(0, 24, 40);
    const raster = await convert(bytes, 'image/x-emf', 64);
    expect(raster).not.toBeNull();
    expect(dimensions(raster!.bytes)).toEqual([64, 32]);
  });

  test('garbage input never yields raster bytes', async () => {
    expect(await convert(new Uint8Array([1, 2, 3, 4]), 'image/x-wmf')).toBeNull();
  });
});

test('embedded TIFF content survives both raster paths', async () => {
  const bytes = emfWithBitmap(baselineRgbTiff(2, 2), 2, 2, [0, 0, 100, 100]);
  const blank = await convert(emf([0, 0, 100, 100], []), 'image/x-emf');
  const installed = drawingRenderers().metafile;
  try {
    for (const renderer of [undefined, metafileRenderer]) {
      installDrawingRenderers({ metafile: renderer });
      const raster = await convertBrowserMetafile(
        bytes,
        'image/x-emf',
        resolveImageResourceLimits()
      );
      expect(raster).not.toBeNull();
      expect(dimensions(raster!.bytes)).toEqual([404, 404]);
      expect(raster!.bytes).not.toEqual(blank!.bytes);
      expect(firstPixel(raster!.bytes)).toEqual([0xe0, 0xc0, 0x80, 0xff]);
    }
  } finally {
    installDrawingRenderers({ metafile: installed });
  }
});

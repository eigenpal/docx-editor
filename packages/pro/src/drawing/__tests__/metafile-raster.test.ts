/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The metafile rasterizer draws through `emf-converter`, which needs a real Canvas that
// headless DOMs lack. These tests cover its contract edges (never invalid bytes out; decline
// or fail cleanly without a canvas).

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from 'bun:test';
import { metafileRenderer } from '../metafile-renderer.ts';

const convert = (bytes: Uint8Array, mime: 'image/x-emf' | 'image/x-wmf') =>
  metafileRenderer.rasterize!(bytes, mime, { maxEdge: 4096 });

describe('browser metafile conversion', () => {
  test('without a working canvas the port declines or fails — never returns bytes', async () => {
    const emf = new Uint8Array(88);
    emf[0] = 0x01;
    emf[40] = 0x20;
    emf[41] = 0x45;
    emf[42] = 0x4d;
    emf[43] = 0x46;
    const outcome = await convert(emf, 'image/x-emf').then(
      (converted) => ({ converted, threw: false }),
      () => ({ converted: null, threw: true })
    );
    if (!outcome.threw && outcome.converted !== null) {
      // If the environment does provide a canvas, the output must be a real PNG.
      expect(outcome.converted.mime).toBe('image/png');
      expect(outcome.converted.bytes[0]).toBe(0x89);
    }
  });

  test('garbage input never yields bytes', async () => {
    const outcome = await convert(new Uint8Array([1, 2, 3, 4]), 'image/x-wmf').then(
      (converted) => converted,
      () => null
    );
    expect(outcome).toBeNull();
  });
});

describe('metafile raster size', () => {
  const calls: unknown[] = [];
  const fake = (size: { width: number; height: number } | null) => ({
    getMetafileInfo: async () => size,
    convertMetafileToDataUrl: async (_bytes: ArrayBuffer, options: unknown) => {
      calls.push(options);
      return 'data:image/png;base64,iVBORw0KGgo=';
    },
  });
  afterEach(() => {
    calls.length = 0;
    mock.restore();
  });

  test('a small picture rasterizes at 4x so it stays sharp on the page', async () => {
    mock.module('emf-converter', () => fake({ width: 109, height: 57 }));
    expect(await convert(new Uint8Array(8), 'image/x-emf')).not.toBeNull();
    expect(calls).toEqual([{ dpiScale: 4, maxWidth: 4096, maxHeight: 4096 }]);
  });

  test('a large picture keeps its own size', async () => {
    mock.module('emf-converter', () => fake({ width: 3000, height: 100 }));
    await convert(new Uint8Array(8), 'image/x-emf');
    expect(calls).toEqual([{ dpiScale: 1, maxWidth: 4096, maxHeight: 4096 }]);
  });

  test('a picture whose size cannot be read renders at scale 1', async () => {
    mock.module('emf-converter', () => fake(null));
    await convert(new Uint8Array(8), 'image/x-wmf');
    expect(calls).toEqual([{ dpiScale: 1, maxWidth: 4096, maxHeight: 4096 }]);
  });
});

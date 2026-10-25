/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The metafile renderer's lazy imports: a failed load declines one picture, not every later one.

import { expect, mock, test } from 'bun:test';

const raster = { bytes: new Uint8Array([1, 2, 3]), mime: 'image/png' as const };
mock.module('../metafile-raster.ts', () => {
  throw new Error('chunk failed to load');
});

const { metafileRenderer } = await import('../metafile-renderer.ts');

test('a failed rasterizer load is retried by the next picture', async () => {
  const bytes = new Uint8Array(8);
  expect(await metafileRenderer.rasterize!(bytes, 'image/x-wmf', { maxEdge: 64 })).toBeNull();
  mock.module('../metafile-raster.ts', () => ({ rasterizeMetafile: async () => raster }));
  expect(await metafileRenderer.rasterize!(bytes, 'image/x-wmf', { maxEdge: 64 })).toBe(raster);
});

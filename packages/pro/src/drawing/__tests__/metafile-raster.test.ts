/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The metafile rasterizer draws through `emf-converter`, which needs a real Canvas that
// headless DOMs lack. These tests cover its contract edges (never invalid bytes out; decline
// or fail cleanly without a canvas).

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
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

// The browser decode port rasterizes metafiles through `emf-converter`. The converter
// needs a real Canvas, which headless DOMs lack — these tests cover the port's own
// contract edges (never invalid bytes out; decline or fail cleanly without a canvas).

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { convertBrowserMetafile } from '../browser-image-decode-port.ts';
import { resolveImageResourceLimits } from '../../store/runtime/limits.ts';

const LIMITS = resolveImageResourceLimits();

describe('browser metafile conversion', () => {
  test('without a working canvas the port declines or fails — never returns bytes', async () => {
    const emf = new Uint8Array(88);
    emf[0] = 0x01;
    emf[40] = 0x20;
    emf[41] = 0x45;
    emf[42] = 0x4d;
    emf[43] = 0x46;
    const outcome = await convertBrowserMetafile(emf, 'image/x-emf', LIMITS).then(
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
    const outcome = await convertBrowserMetafile(
      new Uint8Array([1, 2, 3, 4]),
      'image/x-wmf',
      LIMITS
    ).then(
      (converted) => converted,
      () => null
    );
    expect(outcome).toBeNull();
  });
});

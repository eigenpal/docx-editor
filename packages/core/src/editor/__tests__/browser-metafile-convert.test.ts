// The browser decode port rasterizes metafiles through the installed metafile renderer. Without
// one it declines, and the picture keeps the placeholder of a format the engine cannot decode.

import { afterEach, expect, test } from 'bun:test';
import { convertBrowserMetafile } from '../browser-image-decode-port.ts';
import { resolveImageResourceLimits } from '../../store/runtime/limits.ts';
import {
  drawingRenderers,
  installDrawingRenderers,
  metafileRasterScale,
} from '../../store/package/drawing-renderers.ts';

const LIMITS = resolveImageResourceLimits();
const installed = drawingRenderers().metafile;
afterEach(() => installDrawingRenderers({ metafile: installed }));

test('without a metafile renderer the port declines', async () => {
  installDrawingRenderers({ metafile: undefined });
  expect(await convertBrowserMetafile(new Uint8Array(88), 'image/x-emf', LIMITS)).toBeNull();
});

test('the port rasterizes through the installed renderer', async () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
  const calls: unknown[] = [];
  installDrawingRenderers({
    metafile: {
      replay: async () => null,
      rasterize: async (bytes, mime, options) => {
        calls.push([bytes.length, mime, options.maxEdge]);
        return { bytes: png, mime: 'image/png' };
      },
    },
  });
  const converted = await convertBrowserMetafile(new Uint8Array(12), 'image/x-wmf', LIMITS);
  expect(converted).toEqual({ bytes: png, mime: 'image/png' });
  expect(calls).toEqual([[12, 'image/x-wmf', 4096]]);
});

test('a small metafile rasterizes at up to 4x, toward a 2048-pixel long edge', () => {
  expect(metafileRasterScale(109)).toBe(4);
  expect(metafileRasterScale(1024)).toBe(2);
  expect(metafileRasterScale(2048)).toBe(1);
  // A picture larger than the target never scales below its own size.
  expect(metafileRasterScale(5000)).toBe(1);
  for (const unknown of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    expect(metafileRasterScale(unknown)).toBe(1);
  }
});

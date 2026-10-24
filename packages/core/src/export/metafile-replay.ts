// Replay an EMF or WMF picture into vector drawing commands, for an exporter that draws the
// metafile itself rather than a raster of it.
//
// The replay is the installed metafile renderer's (`store/package/drawing-renderers.ts`).
// Without one, every metafile declines, and the exporter keeps its placeholder.

import { drawingRenderers } from '../store/package/drawing-renderers.ts';
import type { MetafileReplay, MetafileReplayOptions } from '../store/package/metafile-drawing.ts';

export type {
  MetafileCommand,
  MetafileDrawing,
  MetafileFont,
  MetafileMatrix,
  MetafilePaint,
  MetafilePathCommand,
  MetafileRaster,
  MetafileReplay,
  MetafileReplayOptions,
} from '../store/package/metafile-drawing.ts';

/**
 * Replay an EMF or WMF picture into vector drawing commands in canvas pixels, through the
 * installed metafile renderer. Null when the bytes do not replay, or when no metafile renderer
 * is installed. Text keeps its face and position; the caller shapes and draws it.
 * @public
 */
export function replayMetafile(
  bytes: Uint8Array,
  mime: 'image/x-emf' | 'image/x-wmf',
  options: MetafileReplayOptions
): Promise<MetafileReplay | null> {
  const renderer = drawingRenderers().metafile;
  return renderer ? renderer.replay(bytes, mime, options) : Promise.resolve(null);
}

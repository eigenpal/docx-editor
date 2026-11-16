/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Replay an EMF or WMF picture into vector drawing commands, for an exporter that draws the
// metafile itself rather than a raster of it. Loaded on first use: `metafile-renderer.ts`
// imports it, with `emf-converter`, only when a document has a metafile picture.
//
// `emf-converter` records the picture as an SVG tree; `metafile-svg-commands.ts` turns the tree
// into drawing commands. No canvas is involved.

import type { MetafileRenderOptions, MetafileReplay } from '@docx-editor.dev/core/store';
import { inEmfFrame } from './metafile-emf-frame.ts';
import { metafileRecordChain } from './metafile-record-chain.ts';
import { svgTreeDrawing, type SvgTreeNode } from './metafile-svg-commands.ts';

/** Records the converter may process per stream; its own default is larger. */
const MAX_RECORDS = 200_000;
/** The edge the converter sizes the picture to; coordinates only, nothing is rasterized. */
const CANVAS_EDGE = 4096;

/**
 * Replay an EMF or WMF picture into vector drawing commands in picture pixels. Null when the
 * bytes do not replay. Text keeps its face and position; the caller shapes and draws it.
 */
export async function replayMetafile(
  bytes: Uint8Array,
  mime: 'image/x-emf' | 'image/x-wmf',
  _options: MetafileRenderOptions
): Promise<MetafileReplay | null> {
  let tree: SvgTreeNode | null;
  try {
    const { convertMetafileToSvgTree } = await import('emf-converter');
    tree = await convertMetafileToSvgTree(bytes.slice(), {
      dpiScale: 1,
      maxWidth: CANVAS_EDGE,
      maxHeight: CANVAS_EDGE,
      maxCanvasDimension: CANVAS_EDGE,
      maxRecords: MAX_RECORDS,
      imageResampling: 'renderer',
      // Exact raster operations bake shapes into device-resolution pixel patches, which print
      // as jagged blocks. Without them, those shapes stay vectors.
      exactRasterOps: false,
      idPrefix: 'm',
    });
  } catch {
    return null;
  }
  if (!tree || tree.tag !== 'svg') return null;
  const walked = svgTreeDrawing(tree);
  const { exhausted } = walked;
  if (!(walked.drawing.width > 0 && walked.drawing.height > 0)) return null;
  const drawing = inEmfFrame(bytes, walked.drawing);
  // A record that does not fit, or the record limit, stops the converter early; the picture
  // is then partial.
  const chain = exhausted ? 'record-limit' : metafileRecordChain(bytes, mime, MAX_RECORDS);
  if (chain === 'intact') return { drawing, complete: true };
  return {
    drawing,
    complete: false,
    stop: chain === 'malformed-record' ? 'malformed-record' : 'resource-bound',
  };
}

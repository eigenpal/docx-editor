/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// EMF/WMF to PNG in the browser through `emf-converter`, which draws on a canvas. Loaded on
// first use: `metafile-renderer.ts` imports it only when a document has a metafile picture.
// The image pipeline validates the PNG again before the picture paints.

import { metafileRasterScale } from '@docx-editor.dev/core/store';
import type { MetafileImageMime, MetafileRasterImage } from '@docx-editor.dev/core/store';

/** EMF/WMF to PNG no larger than `maxEdge` pixels on a side, or null when it does not draw. */
export async function rasterizeMetafile(
  bytes: Uint8Array,
  _mime: MetafileImageMime,
  options: Readonly<{ maxEdge: number }>
): Promise<MetafileRasterImage | null> {
  const { convertMetafileToDataUrl, getMetafileInfo } = await import('emf-converter');
  // The info read parses the header and records but draws nothing.
  const info = await getMetafileInfo(bytes.slice());
  const dataUrl = await convertMetafileToDataUrl(bytes.slice(), {
    dpiScale: metafileRasterScale(Math.max(info?.width ?? 0, info?.height ?? 0)),
    maxWidth: options.maxEdge,
    maxHeight: options.maxEdge,
  });
  const prefix = 'data:image/png;base64,';
  if (!dataUrl?.startsWith(prefix)) return null;
  const binary = atob(dataUrl.slice(prefix.length));
  const pngBytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    pngBytes[index] = binary.charCodeAt(index);
  }
  return Object.freeze({ bytes: pngBytes, mime: 'image/png' as const });
}

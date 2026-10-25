/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The metafile renderer `installDrawing` installs. It is small on purpose: the replay, the
// rasterizer and `emf-converter` load through dynamic imports the first time a document asks
// for a metafile picture, so a document without one never loads them.
//
// The engine asks once per media part: the image cache keeps one raster per part content, and
// a PDF export keeps one form per part. The imports are cached here.

import type { MetafileRenderer } from '@docx-editor.dev/core/store';

let replayModule: Promise<typeof import('./metafile-replay.ts')> | null = null;
let rasterModule: Promise<typeof import('./metafile-raster.ts')> | null = null;

const renderer: MetafileRenderer = {
  async replay(...args: Parameters<MetafileRenderer['replay']>) {
    replayModule ??= import('./metafile-replay.ts');
    let loaded: typeof import('./metafile-replay.ts');
    try {
      loaded = await replayModule;
    } catch {
      // A failed load declines this picture and lets a later one try again.
      replayModule = null;
      return null;
    }
    return loaded.replayMetafile(...args);
  },
  async rasterize(...args: Parameters<NonNullable<MetafileRenderer['rasterize']>>) {
    rasterModule ??= import('./metafile-raster.ts');
    let loaded: typeof import('./metafile-raster.ts');
    try {
      loaded = await rasterModule;
    } catch {
      // As for replay: decline this picture and let a later one try again.
      rasterModule = null;
      return null;
    }
    return loaded.rasterizeMetafile(...args);
  },
};
/** The metafile renderer: replay for exporters, rasterize for the browser editor. */
export const metafileRenderer: MetafileRenderer = Object.freeze(renderer);

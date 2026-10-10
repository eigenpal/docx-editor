/*
 * NOTICE: third-party vendored code. Do not edit by hand; reinstall with
 * `bunx shadcn@latest add @extend/pdf-viewer` instead.
 *
 * Source: Extend UI (pdf-viewer)
 *   https://www.extend.ai/ui/docs/components/pdf-viewer
 *   https://www.extend.ai/ui/r/styles/new-york/pdf-viewer.json
 * License: MIT. Copyright (c) CrowdView Inc, dba Extend. Portions Copyright (c) 2023 shadcn
 * (https://ui.shadcn.com), MIT License.
 */
import type { PdfDocumentObject, PdfEngine } from '@embedpdf/models';
// Local change: Vite serves the PDFium wasm as an app asset (hashed, cached) instead of the
// upstream jsDelivr CDN URL, so the viewer never fetches code from a third-party host.
import pdfiumWasmAsset from '@embedpdf/pdfium/pdfium.wasm?url';

// Vite hands out a root-relative asset path; the engine fetches it from inside a `blob:`
// worker, where a relative URL has nothing to resolve against, so make it absolute here.
const PDFIUM_WASM_URL = new URL(pdfiumWasmAsset, document.baseURI).href;

let sharedEnginePromise: Promise<PdfEngine> | null = null;
const pdfDocumentCache = new Map<string, Promise<PdfDocumentObject>>();
const thumbnailUrlCache = new Map<string, Promise<string | null>>();

export function loadSharedPdfEngine() {
  // Local change: no fallback-font downloads from a CDN either; the converter embeds every
  // font it uses.
  sharedEnginePromise ??= import('@embedpdf/engines/pdfium-worker-engine').then(
    ({ createPdfiumEngine }) => createPdfiumEngine(PDFIUM_WASM_URL, { fontFallback: null })
  );

  return sharedEnginePromise;
}

export async function loadPdfDocument(url: string) {
  let documentPromise = pdfDocumentCache.get(url);

  if (!documentPromise) {
    documentPromise = loadSharedPdfEngine().then((engine) =>
      engine
        .openDocumentUrl(
          { id: url, url },
          { mode: url.startsWith('blob:') ? 'full-fetch' : 'auto' }
        )
        .toPromise()
    );
    pdfDocumentCache.set(url, documentPromise);
  }

  return documentPromise;
}

export async function getPdfPageCount(url: string) {
  return (await loadPdfDocument(url)).pageCount;
}

export function renderPdfThumbnailUrl({
  dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1,
  pageIndex,
  url,
  width,
}: {
  dpr?: number;
  pageIndex: number;
  url: string;
  width: number;
}) {
  const cacheKey = `${url}#${pageIndex}@${width}x${dpr}`;
  let thumbnailPromise = thumbnailUrlCache.get(cacheKey);

  if (!thumbnailPromise) {
    thumbnailPromise = (async () => {
      const [engine, document] = await Promise.all([loadSharedPdfEngine(), loadPdfDocument(url)]);
      const page = document.pages[pageIndex];

      if (!page) return null;

      const blob = await engine
        .renderThumbnail(document, page, {
          dpr,
          imageType: 'image/png',
          scaleFactor: width / page.size.width,
          withAnnotations: true,
        })
        .toPromise();

      return URL.createObjectURL(blob);
    })();
    thumbnailUrlCache.set(cacheKey, thumbnailPromise);
  }

  return thumbnailPromise;
}

// Browser image decode port for embedded drawing resources (typed-drawings-and-images task 6).
//
// Validates through the same decode contract as tests; layout never reads raw bytes directly.

import type {
  ImageDecodePort,
  MetafileImageMime,
  SupportedImageMime,
} from '../store/package/image-resources.ts';
import type { ImageResourceLimits } from '../store/runtime/limits.ts';

const HUNDREDTH_MM_PER_INCH = 2540;
const CSS_PX_PER_INCH = 96;

/**
 * Intrinsic pixel size from the EMF header's frame rectangle (`rclFrame`, bytes 24–40,
 * four little-endian int32 edges in 0.01 mm). Null when the header is not a plausible EMF.
 */
function emfFramePixelSize(
  bytes: Uint8Array
): Readonly<{ pixelWidth: number; pixelHeight: number }> | null {
  // EMR_HEADER type dword, then " EMF" signature at offset 40 (MS-EMF 2.2.9).
  if (bytes.length < 88) return null;
  if (bytes[0] !== 0x01 || bytes[1] !== 0x00 || bytes[2] !== 0x00 || bytes[3] !== 0x00) return null;
  if (bytes[40] !== 0x20 || bytes[41] !== 0x45 || bytes[42] !== 0x4d || bytes[43] !== 0x46) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const left = view.getInt32(24, true);
  const top = view.getInt32(28, true);
  const right = view.getInt32(32, true);
  const bottom = view.getInt32(36, true);
  const widthMm100 = right - left;
  const heightMm100 = bottom - top;
  if (widthMm100 <= 0 || heightMm100 <= 0) return null;
  const pixelWidth = Math.round((widthMm100 / HUNDREDTH_MM_PER_INCH) * CSS_PX_PER_INCH);
  const pixelHeight = Math.round((heightMm100 / HUNDREDTH_MM_PER_INCH) * CSS_PX_PER_INCH);
  if (!Number.isFinite(pixelWidth) || !Number.isFinite(pixelHeight)) return null;
  if (pixelWidth <= 0 || pixelHeight <= 0) return null;
  return Object.freeze({ pixelWidth, pixelHeight });
}

type EmfRendererModule = Readonly<{
  Renderer: new (buffer: ArrayBuffer) => {
    render(settings: {
      width: string;
      height: string;
      wExt: number;
      hExt: number;
      xExt: number;
      yExt: number;
      mapMode: number;
    }): Element | null;
  };
  loggingEnabled(enabled: boolean): void;
}>;

let emfModuleFlight: Promise<EmfRendererModule> | null = null;

function loadEmfRenderer(): Promise<EmfRendererModule> {
  // Only the EMF module — the rtf.js root entry drags the full RTF renderer along.
  // The bundle ships no types; EmfRendererModule mirrors the surface used here.
  emfModuleFlight ??= import(
    // @ts-expect-error - untyped deep import of the standalone EMF bundle
    'rtf.js/dist/EMFJS.bundle.js'
  ).then((mod: unknown) => {
    // The bundle is UMD; depending on the bundler's CJS interop the namespace arrives as
    // named exports, as `default.EMFJS`, or as the exports object on `default` directly.
    const shapes = mod as {
      EMFJS?: EmfRendererModule;
      default?: { EMFJS?: EmfRendererModule } & EmfRendererModule;
    };
    const emf =
      shapes.EMFJS ??
      shapes.default?.EMFJS ??
      (shapes.default as EmfRendererModule | undefined) ??
      (mod as EmfRendererModule);
    emf.loggingEnabled(false);
    return emf;
  });
  return emfModuleFlight;
}

/**
 * Decode raster headers in the browser via `createImageBitmap`, or null when unavailable.
 * Also converts EMF metafiles to SVG (lazily loaded renderer); the resource layer
 * re-validates the output before it can become a ready resource, and paint only ever
 * shows it through a blob-URL `<img>`, where SVG scripts and external loads are inert.
 */
export function tryCreateBrowserImageDecodePort(ownerDocument: Document): ImageDecodePort | null {
  if (typeof ownerDocument.defaultView?.createImageBitmap !== 'function') return null;
  const view = ownerDocument.defaultView!;
  return Object.freeze({
    async decode(bytes: Uint8Array, mime: SupportedImageMime, limits: ImageResourceLimits) {
      const blob = new Blob([new Uint8Array(bytes)], { type: mime });
      const bitmap = await view.createImageBitmap!(blob);
      try {
        const pixelWidth = bitmap.width;
        const pixelHeight = bitmap.height;
        if (pixelWidth <= 0 || pixelHeight <= 0) {
          throw new Error('image dimensions invalid');
        }
        if (pixelWidth * pixelHeight > limits.maxPixels) {
          throw new Error('image dimensions exceed limits');
        }
        return Object.freeze({ pixelWidth, pixelHeight, dpiX: 96, dpiY: 96 });
      } finally {
        bitmap.close();
      }
    },
    convertMetafile: convertBrowserMetafile,
  });
}

/**
 * EMF → SVG through the lazily loaded renderer; WMF declines (null) so the resource
 * layer keeps its labelled placeholder. Exported for direct unit coverage — the port
 * factory gates on `createImageBitmap`, which headless DOMs lack.
 */
export async function convertBrowserMetafile(
  bytes: Uint8Array,
  mime: MetafileImageMime,
  limits: ImageResourceLimits
): Promise<Readonly<{ svgBytes: Uint8Array; pixelWidth: number; pixelHeight: number }> | null> {
  if (mime !== 'image/x-emf') return null;
  const size = emfFramePixelSize(bytes);
  if (!size) throw new Error('EMF header frame invalid');
  if (size.pixelWidth * size.pixelHeight > limits.maxPixels) {
    throw new Error('EMF frame exceeds pixel limits');
  }
  const { Renderer } = await loadEmfRenderer();
  const copy = new Uint8Array(bytes);
  const rendered = new Renderer(
    copy.buffer.slice(copy.byteOffset, copy.byteOffset + copy.byteLength)
  ).render({
    width: `${size.pixelWidth}px`,
    height: `${size.pixelHeight}px`,
    wExt: size.pixelWidth,
    hExt: size.pixelHeight,
    xExt: size.pixelWidth,
    yExt: size.pixelHeight,
    mapMode: 8,
  });
  if (!rendered) throw new Error('EMF render produced no output');
  const markup = new XMLSerializer().serializeToString(rendered);
  return Object.freeze({
    svgBytes: new TextEncoder().encode(markup),
    pixelWidth: size.pixelWidth,
    pixelHeight: size.pixelHeight,
  });
}

/** Headless fallback: embedded images resolve to unrenderable, never ready. */
export function createHeadlessImageDecodePort(): ImageDecodePort {
  return Object.freeze({
    async decode() {
      throw new Error('Image decode unavailable in headless environment');
    },
  });
}

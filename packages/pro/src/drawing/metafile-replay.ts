/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Replay an EMF or WMF picture into vector drawing commands, for an exporter that draws the
// metafile itself rather than a raster of it. Loaded on first use: `metafile-renderer.ts`
// imports it, with `emf-converter`, only when a document has a metafile picture.
//
// The metafile replayer draws on a canvas. Here the canvas is a recording stand-in, put on
// the global object only while one replay runs, and replays run one at a time.

import {
  MAX_METAFILE_PIXELS,
  RECORDING_MIME,
  RecordingCanvas,
  RecordingImageData,
  type MetafileBudget,
  type MetafileCommand,
  type MetafileFont,
  type MetafileRaster,
  type RecordingBitmap,
  type RecordingContext2D,
} from './metafile-recording.ts';
import { emfWithCanvasMapping } from './metafile-emf-origin.ts';
import {
  scanWmfBitmaps,
  wmfBitmapCommands,
  wmfBitmapMarkerIndex,
  withWmfBitmaps,
} from './metafile-wmf-bitmaps.ts';
import { withWmfText } from './metafile-wmf-text-commands.ts';
import { wmfTextRecords } from './metafile-wmf-text.ts';
import type { MetafileRenderOptions, MetafileReplay } from '@docx-editor.dev/core/store';

/** Records the replayer may process per stream; its own default is larger. */
const MAX_RECORDS = 200_000;
/** The canvas edge the replayer sizes to; coordinates only, nothing is rasterized. */
const CANVAS_EDGE = 4096;

const STAND_INS = ['OffscreenCanvas', 'ImageData', 'createImageBitmap', 'FileReader'] as const;

let queue: Promise<unknown> = Promise.resolve();

function encodedSize(
  bytes: Uint8Array
): { mime: 'image/png' | 'image/jpeg'; width: number; height: number } | null {
  if (
    bytes.length >= 24 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { mime: 'image/png', width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    // Walk segments to the first start-of-frame marker.
    let at = 2;
    while (at + 9 < bytes.length) {
      if (bytes[at] !== 0xff) return null;
      const marker = bytes[at + 1]!;
      const length = (bytes[at + 2]! << 8) | bytes[at + 3]!;
      const isFrame =
        marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isFrame) {
        return {
          mime: 'image/jpeg',
          height: (bytes[at + 5]! << 8) | bytes[at + 6]!,
          width: (bytes[at + 7]! << 8) | bytes[at + 8]!,
        };
      }
      if (length < 2) return null;
      at += 2 + length;
    }
  }
  return null;
}

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (let at = 0; at < bytes.length; at += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  }
  return btoa(binary);
}

async function replayAlone(
  bytes: Uint8Array,
  mime: 'image/x-emf' | 'image/x-wmf',
  options: MetafileRenderOptions
): Promise<MetafileReplay | null> {
  const budget: MetafileBudget = { commands: 0, points: 0, pixels: 0, exhausted: false };
  const recordings = new Map<string, RecordingCanvas>();
  const exportCanvas = (canvas: RecordingCanvas): string => {
    const token = `recording-${recordings.size}`;
    recordings.set(token, canvas);
    return token;
  };
  const measure = (text: string, font: MetafileFont): number => {
    const width = options.textAdvance(text, font);
    return Number.isFinite(width) && width >= 0 ? width : 0;
  };
  // A WMF's bitmap records reach the replayer as text records drawing a marker; the marker is
  // not drawn, and its command index is kept as the bitmap's place in the drawing order.
  const scan = mime === 'image/x-wmf' ? scanWmfBitmaps(bytes) : null;
  const markers = new Map<number, { commands: readonly MetafileCommand[]; at: number }>();
  const marking = new WeakSet<RecordingContext2D>();
  class StandInCanvas extends RecordingCanvas {
    constructor(width: number, height: number) {
      super(width, height, budget, measure, exportCanvas);
    }
    override getContext(kind: string): RecordingContext2D | null {
      const context = super.getContext(kind);
      if (!scan || !context || marking.has(context)) return context;
      marking.add(context);
      const fillText = context.fillText.bind(context);
      context.fillText = (text: string, x: number, y: number) => {
        const index = wmfBitmapMarkerIndex(String(text));
        if (index === null || index >= scan.placed.length) return fillText(text, x, y);
        markers.set(index, { commands: context.commands, at: context.commands.length });
      };
      return context;
    }
  }
  class StandInFileReader {
    result: string | null = null;
    error: unknown = null;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    readAsDataURL(blob: Blob): void {
      void blob
        .arrayBuffer()
        .then((buffer) => {
          this.result = `data:${blob.type || 'application/octet-stream'};base64,${base64(new Uint8Array(buffer))}`;
          this.onload?.();
        })
        .catch((error: unknown) => {
          this.error = error;
          this.onerror?.();
        });
    }
  }
  const createImageBitmap = async (blob: Blob): Promise<RecordingBitmap> => {
    const data = new Uint8Array(await blob.arrayBuffer());
    if (blob.type === RECORDING_MIME) {
      const canvas = recordings.get(new TextDecoder().decode(data));
      if (!canvas) throw new Error('Unknown recording');
      const drawing = canvas.drawing();
      return { width: drawing.width, height: drawing.height, drawing, close() {} };
    }
    const size = encodedSize(data);
    if (!size || !(size.width > 0 && size.height > 0)) throw new Error('Unsupported bitmap');
    // The replayer decodes a bitmap for each placement, so this counts every placement. A
    // raster past the bound is refused: the exporter would expand it to RGBA.
    budget.pixels += size.width * size.height;
    if (budget.pixels > MAX_METAFILE_PIXELS) {
      budget.exhausted = true;
      throw new Error('Bitmap past the pixel bound');
    }
    const raster: MetafileRaster = { kind: 'encoded', ...size, bytes: data };
    return { width: size.width, height: size.height, raster, close() {} };
  };

  const scope = globalThis as Record<string, unknown>;
  const saved = STAND_INS.map((name) => Object.getOwnPropertyDescriptor(scope, name));
  const values: Record<(typeof STAND_INS)[number], unknown> = {
    OffscreenCanvas: StandInCanvas,
    ImageData: RecordingImageData,
    createImageBitmap,
    FileReader: StandInFileReader,
  };
  for (const name of STAND_INS) {
    Object.defineProperty(scope, name, { value: values[name], configurable: true, writable: true });
  }
  try {
    const { convertEmfToDataUrl, convertWmfToDataUrl } = await import('emf-converter');
    const replayOptions = {
      dpiScale: 1,
      maxWidth: CANVAS_EDGE,
      maxHeight: CANVAS_EDGE,
      maxCanvasDimension: CANVAS_EDGE,
      maxRecords: MAX_RECORDS,
    };
    const buffer = (
      mime === 'image/x-emf' ? emfWithCanvasMapping(bytes, replayOptions) : (scan?.marked ?? bytes)
    ).slice().buffer;
    const url =
      mime === 'image/x-emf'
        ? await convertEmfToDataUrl(buffer, replayOptions)
        : await convertWmfToDataUrl(buffer, replayOptions);
    const encoded = url?.startsWith(`data:${RECORDING_MIME};base64,`)
      ? url.slice(url.indexOf(',') + 1)
      : null;
    const canvas = encoded ? recordings.get(atob(encoded)) : undefined;
    if (!canvas) return null;
    const replayed = canvas.drawing();
    const wmf = mime === 'image/x-wmf';
    // The replayer reads a WMF's text bytes as Latin-1; its font records name their own.
    const commands = wmf
      ? withWmfText(replayed.commands, wmfTextRecords(bytes))
      : replayed.commands;
    // The replayer skips a WMF's bitmaps; each paints where its record's marker was drawn.
    // Text decoding maps commands one to one, so the marker indices still hold.
    const groups = scan
      ? wmfBitmapCommands(bytes, scan.placed, replayed.width, replayed.height, budget)
      : [];
    const position = (index: number): number => {
      const marker = markers.get(index);
      return marker && marker.commands === replayed.commands ? marker.at : -1;
    };
    const drawn = groups.some((group) => group.length)
      ? withWmfBitmaps(commands, groups, position)
      : commands;
    return {
      drawing: drawn === replayed.commands ? replayed : { ...replayed, commands: drawn },
      complete: !budget.exhausted,
    };
  } catch {
    return null;
  } finally {
    STAND_INS.forEach((name, index) => {
      const descriptor = saved[index];
      if (descriptor) Object.defineProperty(scope, name, descriptor);
      else delete scope[name];
    });
  }
}

/**
 * Replay an EMF or WMF picture into vector drawing commands in canvas pixels. Null when the
 * bytes do not replay. Text keeps its face and position; the caller shapes and draws it.
 */
export function replayMetafile(
  bytes: Uint8Array,
  mime: 'image/x-emf' | 'image/x-wmf',
  options: MetafileRenderOptions
): Promise<MetafileReplay | null> {
  const run = queue.then(() => replayAlone(bytes, mime, options));
  queue = run.catch(() => undefined);
  return run;
}

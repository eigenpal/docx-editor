// WMF text in its font's character set and face while the rasterizer draws it.
//
// The rasterizer draws WMF text bytes as Latin-1, in a fallback face (see
// `store/package/metafile-wmf-text.ts`). While one conversion runs, the canvases it creates
// draw each text through a matcher that re-decodes it and sets the face its record names.
// Conversions run one at a time, because the stand-in sits on the global constructor.

import { wmfTextMatcher, wmfTextRecords } from '../store/package/metafile-wmf-text.ts';
import type { WmfText } from '../store/package/metafile-wmf-text.ts';

type CanvasConstructor = new (width: number, height: number) => OffscreenCanvas;
type TextContext = Pick<OffscreenCanvasRenderingContext2D, 'fillText' | 'font'>;

let queue: Promise<unknown> = Promise.resolve();

/** `font` with its family list replaced by `face`, or unchanged when it has no pixel size. */
function withFace(font: string, face: string): string {
  const size = /^(.*?\d+(?:\.\d+)?px(?:\/\S+)?)\s/.exec(font);
  return size ? `${size[1]} "${face}", sans-serif` : font;
}

function drawThrough(context: TextContext, match: (text: string) => WmfText | null): void {
  const fill = context.fillText.bind(context);
  context.fillText = (text: string, x: number, y: number, maxWidth?: number) => {
    const found = match(String(text));
    if (found?.face) context.font = withFace(context.font, found.face);
    const value = found ? found.text : text;
    if (maxWidth === undefined) fill(value, x, y);
    else fill(value, x, y, maxWidth);
  };
}

/**
 * Run one WMF conversion with its text drawn in the character set and face its font records
 * name. Text the matcher does not recognize draws as the rasterizer wrote it.
 */
export function withWmfTextCanvas<T>(bytes: Uint8Array, run: () => Promise<T>): Promise<T> {
  const records = wmfTextRecords(bytes);
  if (!records.length) return run();
  const task = queue.then(async () => {
    // The rasterizer creates its canvases from the global constructor of the realm that
    // loaded it, whatever window the editor is mounted in, so the script's global is the one.
    const scope = globalThis as { OffscreenCanvas?: CanvasConstructor };
    const original = scope.OffscreenCanvas;
    if (typeof original !== 'function') return run();
    const match = wmfTextMatcher(records);
    const standIn = function (width: number, height: number): OffscreenCanvas {
      const canvas = new original(width, height);
      const getContext = canvas.getContext.bind(canvas) as (
        id: string,
        options?: unknown
      ) => unknown;
      canvas.getContext = ((id: string, options?: unknown) => {
        const context = getContext(id, options);
        if (id === '2d' && context) drawThrough(context as TextContext, match);
        return context;
      }) as OffscreenCanvas['getContext'];
      return canvas;
    } as unknown as CanvasConstructor;
    scope.OffscreenCanvas = standIn;
    try {
      return await run();
    } finally {
      scope.OffscreenCanvas = original;
    }
  });
  queue = task.catch(() => undefined);
  return task;
}

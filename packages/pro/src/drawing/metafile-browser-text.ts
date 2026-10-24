/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// WMF text in its font's character set and face while the rasterizer draws it.
//
// The rasterizer draws WMF text bytes as Latin-1, in a fallback face (see
// `metafile-wmf-text.ts`). While one conversion runs, the canvases it creates
// draw each text through a matcher that re-decodes it and sets the face its record names.
// Conversions run one at a time, because the stand-in sits on the global constructor.

import { wmfTextMatcher, wmfTextRecords } from './metafile-wmf-text.ts';
import type { WmfText } from './metafile-wmf-text.ts';

type CanvasConstructor = new (width: number, height: number) => OffscreenCanvas;
type TextContext = Pick<
  OffscreenCanvasRenderingContext2D,
  'fillText' | 'font' | 'textBaseline' | 'textAlign'
>;

let queue: Promise<unknown> = Promise.resolve();

/** `font` with its family list replaced by `face`, or unchanged when it has no pixel size. */
function withFace(font: string, face: string): string {
  const size = /^(.*?\d+(?:\.\d+)?px(?:\/\S+)?)\s/.exec(font);
  return size ? `${size[1]} "${face}", sans-serif` : font;
}

/**
 * `font` with a family the canvas can parse. The rasterizer reads the face name four bytes
 * early, so it can start with control bytes; the canvas then drops the whole assignment and
 * keeps its default size, which the picture's scale shrinks to dots.
 */
function parsableFont(font: string): string {
  const size = /^(.*?\d+(?:\.\d+)?px(?:\/\S+)?)\s+(.*)$/.exec(font);
  if (!size || !/[\x00-\x1f\x7f]/.test(size[2]!)) return font;
  return `${size[1]} sans-serif`;
}

/** The `font` accessor the context inherits, found up its prototype chain. */
function fontAccessor(context: object): PropertyDescriptor | undefined {
  for (let proto = Object.getPrototypeOf(context); proto; proto = Object.getPrototypeOf(proto)) {
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'font');
    if (descriptor) return descriptor;
  }
  return undefined;
}

function drawThrough(context: TextContext, match: (text: string) => WmfText | null): void {
  const accessor = fontAccessor(context);
  if (accessor?.get && accessor.set) {
    const { get, set } = accessor;
    Object.defineProperty(context, 'font', {
      configurable: true,
      get: () => get.call(context),
      set: (value: unknown) => set.call(context, parsableFont(String(value))),
    });
  }
  const fill = context.fillText.bind(context);
  context.fillText = (text: string, x: number, y: number, maxWidth?: number) => {
    const found = match(String(text));
    if (found?.face) context.font = withFace(context.font, found.face);
    if (found) {
      context.textBaseline = found.baseline;
      context.textAlign = found.align;
    }
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

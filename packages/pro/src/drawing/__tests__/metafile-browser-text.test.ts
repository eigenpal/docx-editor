/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// While one WMF converts, the rasterizer's canvases draw its text in the character set and
// face its font records name, and the global constructor is restored afterwards.

import { afterEach, expect, test } from 'bun:test';
import { withWmfTextCanvas } from '../metafile-browser-text.ts';
import { wmf, type WmfRecord } from './metafile-fixture.ts';

const scope = globalThis as { OffscreenCanvas?: unknown };
const saved = scope.OffscreenCanvas;
afterEach(() => {
  scope.OffscreenCanvas = saved;
});

/** Canvases that record what their 2D context draws. */
function fakeCanvasConstructor(drawn: { text: string; font: string }[]) {
  return class {
    constructor(
      readonly width: number,
      readonly height: number
    ) {}
    getContext(id: string) {
      if (id !== '2d') return null;
      return {
        font: '10px sans-serif',
        fillText(text: string) {
          drawn.push({ text, font: this.font });
        },
      };
    }
  };
}

function words(bytes: readonly number[]): number[] {
  const even = bytes.length % 2 ? [...bytes, 0] : [...bytes];
  const out: number[] = [];
  for (let at = 0; at < even.length; at += 2) out.push(even[at]! | (even[at + 1]! << 8));
  return out;
}

const hebrewFont: WmfRecord = (() => {
  const logfont = new Array<number>(50).fill(0);
  logfont[13] = 177;
  [...'David'].forEach((char, index) => (logfont[18 + index] = char.charCodeAt(0)));
  return { fn: 0x02fb, words: words(logfont) };
})();
const shalom = [0xf9, 0xec, 0xe5, 0xed]; // windows-1255
const bytes = wmf(100, 50, [
  hebrewFont,
  { fn: 0x012d, words: [0] },
  { fn: 0x0521, words: [shalom.length, ...words(shalom), 10, 10] },
]);

test('the conversion draws text decoded, in the record face, and restores the constructor', async () => {
  const drawn: { text: string; font: string }[] = [];
  const fake = fakeCanvasConstructor(drawn);
  scope.OffscreenCanvas = fake;
  await withWmfTextCanvas(bytes, async () => {
    const Canvas = scope.OffscreenCanvas as new (
      w: number,
      h: number
    ) => {
      getContext(id: string): { fillText(text: string, x: number, y: number): void } | null;
    };
    const context = new Canvas(10, 10).getContext('2d')!;
    context.fillText(String.fromCharCode(...shalom), 1, 2);
    context.fillText('unrelated', 1, 2);
  });
  expect(drawn).toEqual([
    { text: 'שלום', font: '10px "David", sans-serif' },
    { text: 'unrelated', font: '10px "David", sans-serif' },
  ]);
  expect(scope.OffscreenCanvas).toBe(fake);
});

test('a picture with no text runs without a stand-in', async () => {
  const fake = fakeCanvasConstructor([]);
  scope.OffscreenCanvas = fake;
  await withWmfTextCanvas(wmf(10, 10, []), async () => {
    expect(scope.OffscreenCanvas).toBe(fake);
  });
});

test('a font with a control byte in its family keeps its size', async () => {
  const drawn: { text: string; font: string }[] = [];
  /** A context that, like a canvas, ignores a font string it cannot parse. */
  class StrictContext {
    #font = '10px sans-serif';
    textBaseline = 'alphabetic';
    textAlign = 'start';
    get font() {
      return this.#font;
    }
    set font(value: string) {
      if (!/[\x00-\x1f]/.test(value)) this.#font = value;
    }
    fillText(text: string) {
      drawn.push({ text, font: this.font });
    }
  }
  scope.OffscreenCanvas = class {
    getContext() {
      return new StrictContext();
    }
  };
  await withWmfTextCanvas(bytes, async () => {
    const Canvas = scope.OffscreenCanvas as new (
      w: number,
      h: number
    ) => { getContext(id: string): StrictContext };
    const context = new Canvas(10, 10).getContext('2d');
    context.font = '92px \x04@';
    context.fillText(String.fromCharCode(...shalom));
  });
  expect(drawn).toEqual([{ text: 'שלום', font: '92px "David", sans-serif' }]);
});

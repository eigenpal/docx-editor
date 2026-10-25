/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// WMF bitmaps in replay: their place in the drawing order, the window in force at their
// record, top-down source rows, and the pixel bound on EMF+ encoded images.

import { describe, expect, test } from 'bun:test';
import type { MetafileBudget, MetafileCommand } from '../metafile-recording.ts';
import { replayMetafile } from '../metafile-replay.ts';
import { scanWmfBitmaps, wmfBitmapCommands } from '../metafile-wmf-bitmaps.ts';
import { colorWords, dibWords, emf, wmf, type WmfRecord } from './metafile-fixture.ts';

type Rgb = [number, number, number];
const RED: Rgb = [255, 0, 0];
const BLUE: Rgb = [0, 0, 255];
const measureText = (text: string, font: { sizePx: number }) => text.length * font.sizePx * 0.5;
const budget = (): MetafileBudget => ({ commands: 0, points: 0, pixels: 0, exhausted: false });

/** META_STRETCHDIB with SRCCOPY: source (x, y, w, h) into target (x, y, w, h). */
function stretchDib(
  source: readonly [number, number, number, number],
  target: readonly [number, number, number, number],
  dib: readonly number[]
): WmfRecord {
  const [sx, sy, sw, sh] = source;
  const [tx, ty, tw, th] = target;
  return { fn: 0x0f43, words: [0x0020, 0x00cc, 0, sh, sw, sy, sx, th, tw, ty, tx, ...dib] };
}

/** A solid brush selected into slot `slot`. */
function brush(rgb: Rgb, slot: number): WmfRecord[] {
  return [
    { fn: 0x02fc, words: [0, ...colorWords(...rgb), 0] },
    { fn: 0x012d, words: [slot] },
  ];
}

/** META_RECTANGLE (left, top, right, bottom). */
const rectangle = (l: number, t: number, r: number, b: number): WmfRecord => ({
  fn: 0x041b,
  words: [b, r, t, l],
});

function images(commands: readonly MetafileCommand[]) {
  return commands.flatMap((command) => (command.kind === 'image' ? [command] : []));
}

describe('WMF bitmaps', () => {
  test('a bitmap paints over the drawing before its record and under the drawing after', async () => {
    const bytes = wmf(200, 100, [
      { fn: 0x020b, words: [0, 0] },
      { fn: 0x020c, words: [100, 200] },
      ...brush([255, 255, 255], 0),
      rectangle(0, 0, 200, 100),
      stretchDib([0, 0, 1, 1], [20, 10, 100, 50], dibWords([[RED]])),
      ...brush(BLUE, 1),
      rectangle(150, 60, 190, 90),
    ]);
    const replay = await replayMetafile(bytes, 'image/x-wmf', { textAdvance: measureText });
    const commands = replay!.drawing.commands;
    const kinds = commands.map((command) =>
      command.kind === 'fill'
        ? `fill ${command.paint.b === 255 && command.paint.r === 0 ? 'blue' : 'white'}`
        : command.kind
    );
    const image = kinds.indexOf('image');
    expect(image).toBeGreaterThan(kinds.indexOf('fill white'));
    expect(image).toBeLessThan(kinds.indexOf('fill blue'));
    // The marker the replayer draws in the bitmap's place leaves no text behind.
    expect(commands.some((command) => command.kind === 'text')).toBe(false);
  });

  test('a bitmap is placed in the window in force at its record', () => {
    const bytes = wmf(200, 100, [
      { fn: 0x020b, words: [0, 0] },
      { fn: 0x020c, words: [100, 200] },
      stretchDib([0, 0, 1, 1], [0, 0, 100, 50], dibWords([[RED]])),
      { fn: 0x020b, words: [1000, 1000] },
    ]);
    const scan = scanWmfBitmaps(bytes)!;
    const [group] = wmfBitmapCommands(bytes, scan.placed, 400, 200, budget());
    const [image] = images(group!);
    expect(image!.matrix).toEqual([200, 0, 0, 100, 0, 0]);
  });

  test('a partial blit of a top-down DIB counts source rows from the top', () => {
    // dibWords stores its first row at the bottom; reversed and with a negative height, the
    // stored rows read top first: red over blue.
    const dib = dibWords([[BLUE], [RED]]);
    dib[4] = -2 & 0xffff;
    dib[5] = 0xffff;
    const bytes = wmf(100, 100, [
      { fn: 0x020b, words: [0, 0] },
      { fn: 0x020c, words: [100, 100] },
      // The top source row into (0, 40, 100, 20).
      stretchDib([0, 0, 1, 1], [0, 40, 100, 20], dib),
    ]);
    const scan = scanWmfBitmaps(bytes)!;
    const [group] = wmfBitmapCommands(bytes, scan.placed, 100, 100, budget());
    const [image] = images(group!);
    if (image?.raster.kind !== 'rgba') throw new Error('no raster');
    expect(Array.from(image.raster.data.slice(0, 4))).toEqual([255, 0, 0, 255]);
    // Two rows of 20 each, the first at the target's top.
    expect(image.matrix).toEqual([100, 0, 0, 40, 0, 40]);
  });
});

/** Little-endian bytes as the 32-bit signed values the EMF fixture writes. */
function int32s(bytes: Uint8Array): number[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return Array.from({ length: bytes.length / 4 }, (_, index) => view.getInt32(index * 4, true));
}

/** An EMF whose EMF+ records draw one compressed bitmap holding a PNG of `w` × `h`. */
function emfWithPng(w: number, h: number): Uint8Array {
  const png = new Uint8Array(24);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(png.buffer).setUint32(16, w);
  new DataView(png.buffer).setUint32(20, h);
  const records: { type: number; flags: number; data: Uint8Array }[] = [];
  const data = (length: number, write: (view: DataView) => void) => {
    const bytes = new Uint8Array(length);
    write(new DataView(bytes.buffer));
    return bytes;
  };
  // EmfPlusHeader.
  records.push({
    type: 0x4001,
    flags: 0,
    data: data(16, (v) => {
      v.setUint32(0, 0xdbc01002, true);
      v.setUint32(8, 96, true);
      v.setUint32(12, 96, true);
    }),
  });
  // EmfPlusObject: an image in slot 0, a bitmap of compressed (PNG) data.
  records.push({
    type: 0x4008,
    flags: 5 << 8,
    data: data(28 + png.length, (v) => {
      v.setUint32(0, 0xdbc01002, true);
      v.setUint32(4, 1, true);
      v.setUint32(24, 2, true);
      new Uint8Array(v.buffer).set(png, 28);
    }),
  });
  // EmfPlusDrawImage: image 0, source and destination rectangles as floats, in pixels.
  records.push({
    type: 0x401a,
    flags: 0,
    data: data(40, (v) => {
      v.setUint32(4, 2, true);
      [0, 0, w, h, 10, 10, 50, 50].forEach((value, index) =>
        v.setFloat32(8 + index * 4, value, true)
      );
    }),
  });
  records.push({ type: 0x4002, flags: 0, data: new Uint8Array(0) });
  const plus = new Uint8Array(records.reduce((sum, record) => sum + 12 + record.data.length, 0));
  const view = new DataView(plus.buffer);
  let at = 0;
  for (const record of records) {
    view.setUint16(at, record.type, true);
    view.setUint16(at + 2, record.flags, true);
    view.setUint32(at + 4, 12 + record.data.length, true);
    view.setUint32(at + 8, record.data.length, true);
    plus.set(record.data, at + 12);
    at += 12 + record.data.length;
  }
  // EMR_COMMENT holding the EMF+ records.
  return emf(
    [0, 0, 100, 100],
    [{ type: 70, ints: [4 + plus.length, 0x2b464d45, ...int32s(plus)] }]
  );
}

describe('EMF+ encoded images', () => {
  test('a PNG within the pixel bound is drawn', async () => {
    const replay = await replayMetafile(emfWithPng(2, 2), 'image/x-emf', {
      textAdvance: measureText,
    });
    expect(replay?.complete).toBe(true);
    const [image] = images(replay!.drawing.commands);
    expect(image?.raster).toMatchObject({ kind: 'encoded', width: 2, height: 2 });
  });

  test('a PNG declaring more pixels than the bound is refused', async () => {
    const replay = await replayMetafile(emfWithPng(50_000, 50_000), 'image/x-emf', {
      textAdvance: measureText,
    });
    expect(replay?.complete).toBe(false);
    expect(images(replay!.drawing.commands)).toEqual([]);
  });
});

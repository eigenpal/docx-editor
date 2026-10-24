/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Metafile replay into vector commands: the recording canvas, WMF bitmaps, and the replay.

import { describe, expect, test } from 'bun:test';
import { replayMetafile } from '../metafile-replay.ts';
import {
  parseCanvasColor,
  parseCanvasFont,
  RecordingCanvas,
  type MetafileBudget,
  type MetafileCommand,
} from '../metafile-recording.ts';
import { colorWords, dibWords, wmf } from './metafile-fixture.ts';

const measureText = (text: string, font: { sizePx: number }) => text.length * font.sizePx * 0.5;

function canvas(width = 100, height = 50) {
  const budget: MetafileBudget = { commands: 0, points: 0, pixels: 0, exhausted: false };
  const target = new RecordingCanvas(width, height, budget, measureText, () => 'token');
  return { target, ctx: target.getContext('2d')!, budget };
}

describe('recording canvas', () => {
  test('paths take the transform in force when they are built', () => {
    const { ctx } = canvas();
    ctx.setTransform(2, 0, 0, 3, 10, 20);
    ctx.beginPath();
    ctx.rect(1, 1, 4, 2);
    ctx.fillStyle = 'rgb(255, 0, 0)';
    ctx.fill('evenodd');
    const [fill] = ctx.commands;
    expect(fill).toMatchObject({ kind: 'fill', evenOdd: true, paint: { r: 255, g: 0, b: 0 } });
    expect((fill as Extract<MetafileCommand, { kind: 'fill' }>).path.slice(0, 3)).toEqual([
      { op: 'M', x: 12, y: 23 },
      { op: 'L', x: 20, y: 23 },
      { op: 'L', x: 20, y: 29 },
    ]);
  });

  test('a stroke scales its width and dashes by the transform', () => {
    const { ctx } = canvas();
    ctx.scale(2, 2);
    ctx.lineWidth = 3;
    ctx.setLineDash([4, 1]);
    ctx.strokeStyle = '#00ff00';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(5, 0);
    ctx.stroke();
    expect(ctx.commands[0]).toMatchObject({ kind: 'stroke', width: 6, dash: [8, 2] });
  });

  test('a full ellipse closes on its start point with four curves', () => {
    const { ctx } = canvas();
    ctx.beginPath();
    ctx.ellipse(50, 25, 20, 10, 0, 0, Math.PI * 2);
    ctx.fill();
    const path = (ctx.commands[0] as Extract<MetafileCommand, { kind: 'fill' }>).path;
    expect(path.filter((command) => command.op === 'C')).toHaveLength(4);
    const last = path[path.length - 1]!;
    expect(last.op === 'C' && Math.abs(last.x - 70) < 1e-9 && Math.abs(last.y - 25) < 1e-9).toBe(
      true
    );
  });

  test('a fully transparent paint draws nothing', () => {
    const { ctx } = canvas();
    ctx.fillStyle = 'rgba(0, 0, 0, 0)';
    ctx.fillRect(0, 0, 10, 10);
    expect(ctx.commands).toHaveLength(0);
  });

  test('a canvas drawn into another nests as a drawing', () => {
    const outer = canvas();
    const inner = canvas(10, 10);
    inner.ctx.fillRect(0, 0, 5, 5);
    outer.ctx.drawImage(inner.target, 20, 10, 40, 20);
    expect(outer.ctx.commands[0]).toMatchObject({
      kind: 'drawing',
      matrix: [4, 0, 0, 2, 20, 10],
    });
  });

  test('the budget stops recording past its bound', () => {
    const { ctx, budget } = canvas();
    budget.commands = 200_000;
    ctx.fillRect(0, 0, 1, 1);
    expect(budget.exhausted).toBe(true);
    expect(ctx.commands).toHaveLength(0);
  });

  test('colours and fonts parse from the forms the replayer writes', () => {
    expect(parseCanvasColor('#abc')).toEqual({ r: 170, g: 187, b: 204, alpha: 1 });
    expect(parseCanvasColor('rgba(1, 2, 3, 0.5)')).toEqual({ r: 1, g: 2, b: 3, alpha: 0.5 });
    expect(parseCanvasColor('hsl(1, 2%, 3%)')).toBeNull();
    expect(parseCanvasFont('italic bold 12px "Times New Roman"')).toEqual({
      family: 'Times New Roman',
      sizePx: 12,
      bold: true,
      italic: true,
    });
  });

  test('a face name read with the LOGFONT bytes before it is repaired', () => {
    // Output precision 4, clip precision 0x40, quality 0, pitch and family 0x22.
    const garbled = `${String.fromCharCode(0x4004, 0x2200)}Arial`;
    expect(parseCanvasFont(`12px ${garbled}`).family).toBe('Arial');
    expect(parseCanvasFont('12px Arial').family).toBe('Arial');
  });
});

describe('metafile replay', () => {
  test('a WMF polygon replays as a fill in canvas pixels', async () => {
    const bytes = wmf(200, 100, [
      { fn: 0x020b, words: [0, 0] },
      { fn: 0x020c, words: [100, 200] },
      { fn: 0x02fc, words: [0, ...colorWords(0, 0, 255), 0] },
      { fn: 0x012d, words: [0] },
      { fn: 0x02fa, words: [5, 0, 0, ...colorWords(0, 0, 0)] },
      { fn: 0x012d, words: [1] },
      { fn: 0x0324, words: [3, 0, 0, 200, 0, 100, 100] },
    ]);
    const replay = await replayMetafile(bytes, 'image/x-wmf', { textAdvance: measureText });
    expect(replay?.complete).toBe(true);
    const fill = replay!.drawing.commands.find((command) => command.kind === 'fill');
    expect(fill).toMatchObject({ paint: { r: 0, g: 0, b: 255, alpha: 1 } });
    const scale = replay!.drawing.width / 200;
    const points = (fill as Extract<MetafileCommand, { kind: 'fill' }>).path.flatMap((command) =>
      command.op === 'M' || command.op === 'L' ? [[command.x, command.y]] : []
    );
    expect(points).toEqual([
      [0, 0],
      [200 * scale, 0],
      [100 * scale, 100 * scale],
    ]);
  });

  test('a WMF bitmap the replayer skips is placed from its record', async () => {
    const red: [number, number, number] = [255, 0, 0];
    const blue: [number, number, number] = [0, 0, 255];
    const dib = dibWords([
      [red, blue],
      [blue, red],
    ]);
    const bytes = wmf(200, 100, [
      { fn: 0x020b, words: [0, 0] },
      { fn: 0x020c, words: [100, 200] },
      // SRCCOPY, RGB colours, the whole 2×2 source into (20, 10, 100, 50).
      { fn: 0x0f43, words: [0x0020, 0x00cc, 0, 2, 2, 0, 0, 50, 100, 10, 20, ...dib] },
    ]);
    const replay = await replayMetafile(bytes, 'image/x-wmf', { textAdvance: measureText });
    const image = replay!.drawing.commands.find((command) => command.kind === 'image');
    expect(image).toBeTruthy();
    const scale = replay!.drawing.width / 200;
    if (image?.kind !== 'image' || image.raster.kind !== 'rgba') throw new Error('no raster');
    expect(Array.from(image.raster.data.slice(0, 8))).toEqual([255, 0, 0, 255, 0, 0, 255, 255]);
    image.matrix.forEach((value, index) =>
      expect(value).toBeCloseTo([100 * scale, 0, 0, 50 * scale, 20 * scale, 10 * scale][index]!, 6)
    );
  });

  test('a replay leaves no canvas stand-in on the global object', async () => {
    const before = (globalThis as Record<string, unknown>).OffscreenCanvas;
    await replayMetafile(wmf(10, 10, []), 'image/x-wmf', { textAdvance: measureText });
    expect((globalThis as Record<string, unknown>).OffscreenCanvas).toBe(before);
  });

  test('bytes that are not a metafile replay as null', async () => {
    expect(
      await replayMetafile(new Uint8Array(64), 'image/x-emf', { textAdvance: measureText })
    ).toBeNull();
  });
});

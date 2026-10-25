/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The point budget is checked before a path is built or copied, so a stream that repeats one
// large path stops costing work once the budget ends.

import { expect, test } from 'bun:test';
import {
  MAX_METAFILE_POINTS,
  RecordingCanvas,
  type MetafileBudget,
} from '../metafile-recording.ts';

function context(budget: MetafileBudget) {
  const canvas = new RecordingCanvas(
    100,
    100,
    budget,
    () => 0,
    () => ''
  );
  const ctx = canvas.getContext('2d')!;
  ctx.strokeStyle = '#000000';
  ctx.fillStyle = '#000000';
  return ctx;
}

test('repeated strokes of a path past the budget record nothing more', () => {
  const budget: MetafileBudget = { commands: 0, points: 0, pixels: 0, exhausted: false };
  const ctx = context(budget);
  const half = Math.floor(MAX_METAFILE_POINTS / 2) + 10;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  for (let index = 1; index < half; index += 1) ctx.lineTo(index % 100, index % 7);
  ctx.stroke();
  ctx.stroke();
  expect(budget.exhausted).toBe(true);
  const recorded = ctx.commands.length;
  for (let repeat = 0; repeat < 50; repeat += 1) {
    ctx.stroke();
    ctx.fill();
    ctx.clip();
  }
  expect(ctx.commands.length).toBe(recorded);
  expect(budget.points).toBeLessThanOrEqual(MAX_METAFILE_POINTS);
});

test('path building stops once the budget ends', () => {
  const budget: MetafileBudget = {
    commands: 0,
    points: MAX_METAFILE_POINTS - 5,
    pixels: 0,
    exhausted: false,
  };
  const ctx = context(budget);
  ctx.beginPath();
  for (let index = 0; index < 100; index += 1) ctx.lineTo(index, index);
  expect(budget.exhausted).toBe(true);
  ctx.stroke();
  expect(ctx.commands).toEqual([]);
});

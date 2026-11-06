/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// An EMF with its own window and viewport mapping draws from its bounds corner, and the
// picture is its header frame.

import { describe, expect, test } from 'bun:test';
import type { MetafileCommand } from '@docx-editor.dev/core/store';
import { replayMetafile } from '../metafile-replay.ts';
import { emf, replayWithoutDom, type EmfRecord } from './metafile-fixture.ts';

replayWithoutDom();

const measureText = (text: string, font: { sizePx: number }) => text.length * font.sizePx * 0.5;

/** A blue polygon over logical (72, -597)–(645, -72), which is device (24, -199)–(215, -24). */
const POLYGON: readonly EmfRecord[] = [
  { type: 39, ints: [1, 0, 0xff0000, 0] },
  { type: 37, ints: [1] },
  { type: 3, ints: [72, -597, 645, -72, 4, 72, -597, 645, -597, 645, -72, 72, -72] },
];

const MAPPING: readonly EmfRecord[] = [
  { type: 17, ints: [8] },
  { type: 10, ints: [0, 0] },
  { type: 12, ints: [0, 0] },
  { type: 9, ints: [300, 300] },
  { type: 11, ints: [100, 100] },
];

function fillPoints(commands: readonly MetafileCommand[]): number[][] {
  const fill = commands.find((command) => command.kind === 'fill');
  if (fill?.kind !== 'fill') throw new Error('no fill');
  return fill.path.flatMap((command) =>
    command.op === 'M' || command.op === 'L' ? [[command.x, command.y]] : []
  );
}

describe('EMF canvas mapping', () => {
  test('device pixels draw from the bounds corner of the canvas', async () => {
    const bytes = emf([24, -199, 215, -24], [...MAPPING, ...POLYGON]);
    const replay = await replayMetafile(bytes, 'image/x-emf', { textAdvance: measureText });
    // The bounds include both edges, so the picture is 192 device pixels wide.
    const scale = replay!.drawing.width / 192;
    const points = fillPoints(replay!.drawing.commands);
    const expected = [
      [0, 0],
      [191, 0],
      [191, 175],
      [0, 175],
    ];
    expect(points).toHaveLength(4);
    points.forEach(([x, y], index) => {
      expect(x!).toBeCloseTo(expected[index]![0]! * scale, 0);
      expect(y!).toBeCloseTo(expected[index]![1]! * scale, 0);
    });
  });
});

describe('EMF picture frame', () => {
  test('ink inside a larger frame keeps its margin', async () => {
    const bytes = emf([24, -199, 215, -24], [...MAPPING, ...POLYGON]);
    // Widen the frame by 24 device pixels on every side: 0.3125 mm, or 31.25 units, a pixel.
    const view = new DataView(bytes.buffer);
    [0, -223, 239, 0].forEach((pixels, index) =>
      view.setInt32(24 + index * 4, pixels * 31.25, true)
    );
    const replay = await replayMetafile(bytes, 'image/x-emf', { textAdvance: measureText });
    const [placed] = replay!.drawing.commands;
    if (placed?.kind !== 'drawing') throw new Error('not placed in the frame');
    const scale = placed.drawing.width / 192;
    expect(replay!.drawing.width).toBeCloseTo(239 * scale, 0);
    expect(replay!.drawing.height).toBeCloseTo(223 * scale, 0);
    [1, 0, 0, 1, 24 * scale, 24 * scale].forEach((value, index) =>
      expect(placed.matrix[index]!).toBeCloseTo(value, 1)
    );
  });

  test('a frame far from the bounds is not trusted', async () => {
    const bytes = emf([24, -199, 215, -24], [...MAPPING, ...POLYGON]);
    new DataView(bytes.buffer).setInt32(32, 100_000 * 31.25, true);
    const replay = await replayMetafile(bytes, 'image/x-emf', { textAdvance: measureText });
    expect(replay!.drawing.commands.some((command) => command.kind === 'drawing')).toBe(false);
  });
});

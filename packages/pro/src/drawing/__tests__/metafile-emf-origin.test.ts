/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// An EMF with its own window and viewport mapping draws from its bounds corner.

import { describe, expect, test } from 'bun:test';
import { emfWithCanvasMapping } from '../metafile-emf-origin.ts';
import type { MetafileCommand } from '../metafile-recording.ts';
import { replayMetafile } from '../metafile-replay.ts';
import { emf, type EmfRecord } from './metafile-fixture.ts';

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
    const scale = replay!.drawing.width / 191;
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

  test('the canvas scale applies to device pixels', () => {
    const bytes = emf([10, 20, 210, 120], [...MAPPING, ...POLYGON]);
    const mapped = emfWithCanvasMapping(bytes, { maxWidth: 100 });
    const view = new DataView(mapped.buffer);
    // The inserted viewport origin, then the stream's own viewport extent at half scale.
    expect([view.getInt32(88 + 16 + 8, true), view.getInt32(88 + 16 + 12, true)]).toEqual([
      -5, -10,
    ]);
    expect(view.getUint32(48, true)).toBe(mapped.length);
  });

  test('a stream without its own viewport extent is left as it is', () => {
    const bytes = emf([24, -199, 215, -24], [{ type: 9, ints: [300, 300] }, ...POLYGON]);
    expect(emfWithCanvasMapping(bytes, {})).toBe(bytes);
  });
});

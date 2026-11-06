/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Metafile replay into vector commands: the SVG tree mapping, its path data, and the replay.

import { describe, expect, test } from 'bun:test';
import type { MetafileCommand } from '@docx-editor.dev/core/store';
import { replayMetafile } from '../metafile-replay.ts';
import {
  MAX_METAFILE_COMMANDS,
  parseSvgColor,
  svgTreeDrawing,
  type SvgTreeNode,
} from '../metafile-svg-commands.ts';
import { parseSvgPath } from '../metafile-svg-path.ts';
import { colorWords, dibWords, replayWithoutDom, wmf } from './metafile-fixture.ts';

replayWithoutDom();

const measureText = (text: string, font: { sizePx: number }) => text.length * font.sizePx * 0.5;

const svg = (children: SvgTreeNode[], attrs: Record<string, string> = {}): SvgTreeNode => ({
  tag: 'svg',
  attrs: { width: '100', height: '50', viewBox: '0 0 100 50', ...attrs },
  children,
});

const kinds = (commands: readonly MetafileCommand[]) => commands.map((command) => command.kind);

describe('SVG tree mapping', () => {
  test('paths take the transforms of their element and groups', () => {
    const { drawing } = svgTreeDrawing(
      svg([
        {
          tag: 'g',
          attrs: { transform: 'matrix(2 0 0 3 10 20)' },
          children: [{ tag: 'path', attrs: { d: 'M0 0L5 5', fill: '#ff0000' } }],
        },
      ])
    );
    const [fill] = drawing.commands;
    expect(fill).toMatchObject({
      kind: 'fill',
      path: [
        { op: 'M', x: 10, y: 20 },
        { op: 'L', x: 20, y: 35 },
      ],
      paint: { r: 255, g: 0, b: 0, alpha: 1 },
    });
  });

  test('the viewBox maps onto the picture size', () => {
    const { drawing } = svgTreeDrawing(
      svg([{ tag: 'path', attrs: { d: 'M10 10L20 20', fill: '#000' } }], {
        width: '200',
        height: '100',
        viewBox: '0 0 100 50',
      })
    );
    expect(drawing).toMatchObject({ width: 200, height: 100 });
    expect(drawing.commands[0]).toMatchObject({
      path: [
        { x: 20, y: 20 },
        { x: 40, y: 40 },
      ],
    });
  });

  test('a stroke scales its width and dashes by the transform', () => {
    const { drawing } = svgTreeDrawing(
      svg([
        {
          tag: 'path',
          attrs: {
            d: 'M0 0L10 0',
            fill: 'none',
            stroke: '#0000ff',
            'stroke-width': '2',
            'stroke-dasharray': '3 1',
            transform: 'matrix(2 0 0 2 0 0)',
          },
        },
      ])
    );
    expect(drawing.commands).toEqual([
      expect.objectContaining({ kind: 'stroke', width: 4, dash: [6, 2] }),
    ]);
  });

  test('a shape with no fill attribute fills black; none and transparent draw nothing', () => {
    const { drawing } = svgTreeDrawing(
      svg([
        { tag: 'path', attrs: { d: 'M0 0L1 1' } },
        { tag: 'path', attrs: { d: 'M0 0L1 1', fill: 'none' } },
        { tag: 'path', attrs: { d: 'M0 0L1 1', fill: '#ff0000', 'fill-opacity': '0' } },
      ])
    );
    expect(drawing.commands).toHaveLength(1);
    expect(drawing.commands[0]).toMatchObject({ paint: { r: 0, g: 0, b: 0, alpha: 1 } });
  });

  test('a clip reference wraps the element in a save, a clip, and a restore', () => {
    const { drawing } = svgTreeDrawing(
      svg([
        {
          tag: 'defs',
          attrs: {},
          children: [
            {
              tag: 'clipPath',
              attrs: { id: 'c0' },
              children: [{ tag: 'path', attrs: { d: 'M0 0H10V10H0Z', 'clip-rule': 'evenodd' } }],
            },
          ],
        },
        {
          tag: 'g',
          attrs: { 'clip-path': 'url(#c0)' },
          children: [{ tag: 'path', attrs: { d: 'M0 0L5 5', fill: '#000' } }],
        },
      ])
    );
    expect(kinds(drawing.commands)).toEqual(['save', 'clip', 'fill', 'restore']);
    expect(drawing.commands[1]).toMatchObject({ evenOdd: true });
  });

  test('a clip reference to nothing hides the element', () => {
    const { drawing } = svgTreeDrawing(
      svg([{ tag: 'path', attrs: { d: 'M0 0L5 5', fill: '#000', 'clip-path': 'url(#gone)' } }])
    );
    expect(drawing.commands.some((command) => command.kind === 'fill')).toBe(false);
  });

  test('a gradient paints as the mean of its stops', () => {
    const { drawing } = svgTreeDrawing(
      svg([
        {
          tag: 'linearGradient',
          attrs: { id: 'g0' },
          children: [
            { tag: 'stop', attrs: { offset: '0', 'stop-color': '#000000' } },
            { tag: 'stop', attrs: { offset: '1', 'stop-color': '#ffffff', 'stop-opacity': '0' } },
          ],
        },
        { tag: 'path', attrs: { d: 'M0 0L5 5', fill: 'url(#g0)' } },
      ])
    );
    expect(drawing.commands[0]).toMatchObject({
      paint: { r: 127.5, g: 127.5, b: 127.5, alpha: 0.5 },
    });
  });

  test('text keeps its face, position, baseline, and transform', () => {
    const { drawing } = svgTreeDrawing(
      svg([
        {
          tag: 'text',
          attrs: {
            x: '5',
            y: '6',
            'font-family': '"Times New Roman"',
            'font-size': '12',
            'font-weight': 'bold',
            'font-style': 'italic',
            'dominant-baseline': 'text-before-edge',
            fill: '#000000',
            transform: 'matrix(1 0 0 1 3 4)',
          },
          text: 'W',
        },
      ])
    );
    expect(drawing.commands[0]).toEqual({
      kind: 'text',
      text: 'W',
      font: { family: 'Times New Roman', sizePx: 12, bold: true, italic: true },
      x: 5,
      y: 6,
      align: 'left',
      baseline: 'top',
      matrix: [1, 0, 0, 1, 3, 4],
      paint: { r: 0, g: 0, b: 0, alpha: 1 },
    });
  });

  test('a face name read with the LOGFONT bytes before it is repaired', () => {
    const garbled = `${String.fromCharCode(0x4004, 0x2200)}Arial`;
    const { drawing } = svgTreeDrawing(
      svg([{ tag: 'text', attrs: { 'font-family': garbled, 'font-size': '10' }, text: 'a' }])
    );
    expect(drawing.commands[0]).toMatchObject({ font: { family: 'Arial' } });
  });

  test('an image draws its PNG into its box; other data is skipped', () => {
    const png = new Uint8Array(24);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
    new DataView(png.buffer).setUint32(16, 3);
    new DataView(png.buffer).setUint32(20, 2);
    const href = `data:image/png;base64,${btoa(String.fromCharCode(...png))}`;
    const { drawing } = svgTreeDrawing(
      svg([
        { tag: 'image', attrs: { x: '1', y: '2', width: '30', height: '20', href } },
        {
          tag: 'image',
          attrs: { width: '5', height: '5', href: 'data:image/svg+xml;base64,AA==' },
        },
        { tag: 'image', attrs: { width: '5', height: '5', href: 'https://example.com/a.png' } },
      ])
    );
    expect(drawing.commands).toEqual([
      expect.objectContaining({
        kind: 'image',
        raster: expect.objectContaining({ kind: 'encoded', width: 3, height: 2 }),
        matrix: [30, 0, 0, 20, 1, 2],
      }),
    ]);
  });

  test('images past the pixel bound stop the walk', () => {
    const png = new Uint8Array(24);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
    new DataView(png.buffer).setUint32(16, 5000);
    new DataView(png.buffer).setUint32(20, 5000);
    const href = `data:image/png;base64,${btoa(String.fromCharCode(...png))}`;
    const { drawing, exhausted } = svgTreeDrawing(
      svg([{ tag: 'image', attrs: { width: '5', height: '5', href } }])
    );
    expect(exhausted).toBe(true);
    expect(drawing.commands).toEqual([]);
  });

  test('the command bound stops the walk', () => {
    const many = Array.from({ length: MAX_METAFILE_COMMANDS + 5 }, () => ({
      tag: 'path',
      attrs: { d: 'M0 0L1 1', fill: '#000' },
    }));
    const { drawing, exhausted } = svgTreeDrawing(svg(many));
    expect(exhausted).toBe(true);
    expect(drawing.commands).toHaveLength(MAX_METAFILE_COMMANDS);
  });

  test('deep nesting stops the walk instead of the stack', () => {
    let node: SvgTreeNode = { tag: 'path', attrs: { d: 'M0 0L1 1', fill: '#000' } };
    for (let depth = 0; depth < 10_000; depth += 1)
      node = { tag: 'g', attrs: {}, children: [node] };
    const { exhausted } = svgTreeDrawing(svg([node]));
    expect(exhausted).toBe(true);
  });

  test('colours parse from the forms the converter writes', () => {
    expect(parseSvgColor('#0080ff')).toEqual({ r: 0, g: 128, b: 255, alpha: 1 });
    expect(parseSvgColor('#f00')).toEqual({ r: 255, g: 0, b: 0, alpha: 1 });
    expect(parseSvgColor('rgba(1, 2, 3, 0.5)')).toEqual({ r: 1, g: 2, b: 3, alpha: 0.5 });
    expect(parseSvgColor('url(#x)')).toBeNull();
  });
});

describe('SVG path data', () => {
  test('relative and compact commands resolve to absolute points', () => {
    expect(parseSvgPath('M1.5 2l3 0 0 4-3 0zm0 0', 100)).toEqual([
      { op: 'M', x: 1.5, y: 2 },
      { op: 'L', x: 4.5, y: 2 },
      { op: 'L', x: 4.5, y: 6 },
      { op: 'L', x: 1.5, y: 6 },
      { op: 'Z' },
      { op: 'M', x: 1.5, y: 2 },
    ]);
  });

  test('horizontal, vertical, smooth, quadratic, and exponent forms parse', () => {
    const path = parseSvgPath('M0 0H10V1e1h-5v-5C1 1 2 2 3 3S5 5 6 6Q7 7 8 8T10 10', 100);
    if (path === 'too-long') throw new Error('too long');
    expect(path.map((command) => command.op)).toEqual([
      'M',
      'L',
      'L',
      'L',
      'L',
      'C',
      'C',
      'C',
      'C',
    ]);
    expect(path[2]).toEqual({ op: 'L', x: 10, y: 10 });
    expect(path[6]).toMatchObject({ x1: 4, y1: 4 });
    expect(path.at(-1)).toMatchObject({ x: 10, y: 10 });
  });

  test('an arc becomes cubic curves ending on its end point', () => {
    const path = parseSvgPath('M0 0A5 5 0 0 1 10 0', 100);
    if (path === 'too-long') throw new Error('too long');
    expect(path.slice(1).every((command) => command.op === 'C')).toBe(true);
    expect(path.at(-1)).toMatchObject({ x: 10, y: 0 });
  });

  test('malformed data keeps the commands before it', () => {
    expect(parseSvgPath('M0 0L1 1L2', 100)).toEqual([
      { op: 'M', x: 0, y: 0 },
      { op: 'L', x: 1, y: 1 },
    ]);
    expect(parseSvgPath('M0 0 L1 x 2', 100)).toEqual([{ op: 'M', x: 0, y: 0 }]);
  });

  test('a path past the point bound is too long', () => {
    expect(parseSvgPath('M0 0L1 1L2 2L3 3', 3)).toBe('too-long');
  });
});

describe('metafile replay', () => {
  test('a WMF polygon replays as a fill in picture pixels', async () => {
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
  });

  test('a WMF bitmap is placed from its record', async () => {
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
    if (image?.kind !== 'image') throw new Error('no image');
    // The converter embeds the blit at its destination size.
    expect(image.raster).toMatchObject({ kind: 'encoded', mime: 'image/png' });
    const scale = replay!.drawing.width / 200;
    image.matrix.forEach((value, index) =>
      expect(value).toBeCloseTo([100 * scale, 0, 0, 50 * scale, 20 * scale, 10 * scale][index]!, 1)
    );
  });

  test('a replay leaves no canvas on the global object', async () => {
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

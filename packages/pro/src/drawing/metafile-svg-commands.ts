/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The vector drawing commands of a metafile's SVG tree, as `emf-converter` records it.
//
// The tree uses a small part of SVG: `svg`, `g`, `path`, `rect`, `text`, `image`, `clipPath`,
// and `linearGradient` with its stops, with solid fills and strokes, `matrix()` transforms,
// and clip references. Anything else is skipped.
//
// Every value in the tree comes from attacker-controlled metafile bytes. The walk keeps finite
// numbers only, bounds commands, path points, raster pixels, and depth, and stops once a bound
// is reached.

import type {
  MetafileCommand,
  MetafileDrawing,
  MetafileFont,
  MetafileMatrix,
  MetafilePaint,
  MetafilePathCommand,
  MetafileRaster,
} from '@docx-editor.dev/core/store';
import { parseSvgPath } from './metafile-svg-path.ts';

/** One element of the converter's SVG tree. */
export interface SvgTreeNode {
  readonly tag: string;
  readonly attrs: Readonly<Record<string, string | number>>;
  readonly children?: readonly SvgTreeNode[];
  readonly text?: string;
}

export const MAX_METAFILE_COMMANDS = 200_000;
export const MAX_METAFILE_POINTS = 2_000_000;
export const MAX_METAFILE_PIXELS = 16_000_000;
/** Groups, nested pictures, and clip references nest no deeper than this. */
const MAX_DEPTH = 64;

const IDENTITY: MetafileMatrix = [1, 0, 0, 1, 0, 0];
const BLACK: MetafilePaint = { r: 0, g: 0, b: 0, alpha: 1 };

/** A drawing and whether a bound stopped the walk early. */
export interface SvgTreeDrawing {
  readonly drawing: MetafileDrawing;
  readonly exhausted: boolean;
}

export function multiply(m: MetafileMatrix, n: MetafileMatrix): MetafileMatrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

const number = (value: unknown, fallback = 0): number => {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : fallback;
};

const attr = (node: SvgTreeNode, name: string): string | undefined => {
  const value = node.attrs[name];
  return value === undefined ? undefined : String(value);
};

/** `matrix(a b c d e f)`, `translate()`, and `scale()`; anything else is the identity. */
export function parseTransform(value: string | undefined): MetafileMatrix {
  if (!value) return IDENTITY;
  let matrix = IDENTITY;
  const pattern = /(matrix|translate|scale)\s*\(([^)]*)\)/g;
  for (let match = pattern.exec(value); match; match = pattern.exec(value)) {
    const args = match[2]!
      .split(/[\s,]+/)
      .filter(Boolean)
      .map((part) => number(part));
    let next: MetafileMatrix = IDENTITY;
    if (match[1] === 'matrix' && args.length === 6) {
      next = args as unknown as MetafileMatrix;
    } else if (match[1] === 'translate' && args.length >= 1) {
      next = [1, 0, 0, 1, args[0]!, args[1] ?? 0];
    } else if (match[1] === 'scale' && args.length >= 1) {
      next = [args[0]!, 0, 0, args[1] ?? args[0]!, 0, 0];
    }
    matrix = multiply(matrix, next);
  }
  return matrix.every(Number.isFinite) ? matrix : IDENTITY;
}

/** `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb()`, `rgba()`, or a few names. Null for anything else. */
export function parseSvgColor(value: string | undefined): MetafilePaint | null {
  if (value === undefined) return null;
  const text = value.trim().toLowerCase();
  if (text === 'transparent') return { r: 0, g: 0, b: 0, alpha: 0 };
  if (text === 'black') return BLACK;
  if (text === 'white') return { r: 255, g: 255, b: 255, alpha: 1 };
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(text);
  if (hex) {
    const digits =
      hex[1]!.length === 3
        ? hex[1]!
            .split('')
            .map((digit) => digit + digit)
            .join('')
        : hex[1]!;
    const channel = (at: number) => Number.parseInt(digits.slice(at, at + 2), 16);
    return {
      r: channel(0),
      g: channel(2),
      b: channel(4),
      alpha: digits.length === 8 ? channel(6) / 255 : 1,
    };
  }
  const rgb = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(
    text
  );
  if (!rgb) return null;
  const clamp = (raw: string, max: number) => Math.max(0, Math.min(max, Number(raw) || 0));
  return {
    r: clamp(rgb[1]!, 255),
    g: clamp(rgb[2]!, 255),
    b: clamp(rgb[3]!, 255),
    alpha: rgb[4] === undefined ? 1 : clamp(rgb[4], 1),
  };
}

const opacity = (value: string | undefined): number =>
  value === undefined ? 1 : Math.max(0, Math.min(1, number(value, 1)));

/**
 * The face name with the four LOGFONT bytes before it removed, when the converter read them
 * as part of the name. Those bytes are the output precision (0–10), clip precision flags, the
 * quality (0–6), and the pitch and family byte (pitch 0–2, family 0–5), so the two UTF-16 units
 * they make have a shape no face name starts with.
 */
export function repairFaceName(face: string): string {
  if (face.length < 3) return face;
  const first = face.charCodeAt(0);
  const second = face.charCodeAt(1);
  const outPrecision = first & 0xff;
  const clipPrecision = first >> 8;
  const quality = second & 0xff;
  const pitchAndFamily = second >> 8;
  const looksLikeLogfont =
    outPrecision <= 10 &&
    (clipPrecision & 0x0c) === 0 &&
    quality <= 6 &&
    (pitchAndFamily & 0x0c) === 0 &&
    (pitchAndFamily & 0x03) <= 2 &&
    pitchAndFamily >> 4 <= 5 &&
    (first > 0x7f || second > 0x7f);
  return looksLikeLogfont ? face.slice(2) : face;
}

/** The first family of a `font-family` list, unquoted. */
function fontFamily(value: string | undefined): string {
  const first = (value ?? '').split(',')[0]!.trim();
  const unquoted = first.replace(/^(["'])(.*)\1$/, '$2').replace(/\\(.)/g, '$1');
  return repairFaceName(unquoted) || 'Arial';
}

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

function dataUrlBytes(href: string): Uint8Array | null {
  const match = /^data:image\/(?:png|jpeg);base64,/i.exec(href);
  if (!match) return null;
  try {
    const binary = atob(href.slice(match[0].length).replace(/\s+/g, ''));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return null;
  }
}

function collectIds(node: SvgTreeNode, ids: Map<string, SvgTreeNode>, depth: number): void {
  if (depth > MAX_DEPTH) return;
  const id = attr(node, 'id');
  if (id !== undefined && !ids.has(id)) ids.set(id, node);
  for (const child of node.children ?? []) collectIds(child, ids, depth + 1);
}

/** `url(#id)` to `id`. */
const reference = (value: string | undefined): string | null =>
  /^\s*url\(\s*["']?#([^"')]+)["']?\s*\)\s*$/.exec(value ?? '')?.[1] ?? null;

class Walk {
  readonly commands: MetafileCommand[] = [];
  private readonly ids = new Map<string, SvgTreeNode>();
  private commandCount = 0;
  private points = 0;
  private pixels = 0;
  exhausted = false;

  constructor(root: SvgTreeNode) {
    collectIds(root, this.ids, 0);
  }

  private push(command: MetafileCommand, points = 0): void {
    if (this.exhausted) return;
    this.commandCount += 1;
    this.points += points;
    if (this.commandCount > MAX_METAFILE_COMMANDS || this.points > MAX_METAFILE_POINTS) {
      this.exhausted = true;
      return;
    }
    this.commands.push(command);
  }

  /** The path `d` in canvas pixels, or null when it is empty or past the point bound. */
  private path(d: string | undefined, ctm: MetafileMatrix): MetafilePathCommand[] | null {
    if (!d || this.exhausted) return null;
    const parsed = parseSvgPath(d, MAX_METAFILE_POINTS - this.points);
    if (parsed === 'too-long') {
      this.exhausted = true;
      return null;
    }
    if (!parsed.length) return null;
    const [a, b, c, d2, e, f] = ctm;
    const x = (px: number, py: number) => a * px + c * py + e;
    const y = (px: number, py: number) => b * px + d2 * py + f;
    return parsed.map((command): MetafilePathCommand => {
      if (command.op === 'Z') return command;
      if (command.op === 'C') {
        return {
          op: 'C',
          x1: x(command.x1, command.y1),
          y1: y(command.x1, command.y1),
          x2: x(command.x2, command.y2),
          y2: y(command.x2, command.y2),
          x: x(command.x, command.y),
          y: y(command.x, command.y),
        };
      }
      return { op: command.op, x: x(command.x, command.y), y: y(command.x, command.y) };
    });
  }

  /** A solid paint for `fill` or `stroke`; a gradient paints as the mean of its stops. */
  private paint(value: string | undefined, alpha: number): MetafilePaint | null {
    const id = reference(value);
    let paint: MetafilePaint | null;
    if (id !== null) {
      const gradient = this.ids.get(id);
      paint = gradient && /Gradient$/.test(gradient.tag) ? this.gradientMean(gradient) : null;
    } else {
      paint = value === undefined || value.trim() === 'none' ? null : parseSvgColor(value);
    }
    if (!paint) return null;
    const scaled = { ...paint, alpha: paint.alpha * alpha };
    return scaled.alpha > 0 ? scaled : null;
  }

  private gradientMean(gradient: SvgTreeNode): MetafilePaint {
    const stops = (gradient.children ?? [])
      .filter((child) => child.tag === 'stop')
      .slice(0, 256)
      .map((stop) => {
        const color = parseSvgColor(attr(stop, 'stop-color')) ?? BLACK;
        return { ...color, alpha: color.alpha * opacity(attr(stop, 'stop-opacity')) };
      });
    if (!stops.length) return BLACK;
    const mean = (key: keyof MetafilePaint) =>
      stops.reduce((total, stop) => total + stop[key], 0) / stops.length;
    return { r: mean('r'), g: mean('g'), b: mean('b'), alpha: mean('alpha') };
  }

  /** Emit the clip a `clip-path` reference names. False when nothing can be drawn inside it. */
  private clip(value: string | undefined, ctm: MetafileMatrix, depth: number): boolean {
    const id = reference(value);
    if (id === null) return true;
    const clipPath = this.ids.get(id);
    if (!clipPath || clipPath.tag !== 'clipPath' || depth > MAX_DEPTH) return false;
    // A clip path can itself be clipped; that clip applies first.
    if (!this.clip(attr(clipPath, 'clip-path'), ctm, depth + 1)) return false;
    const path: MetafilePathCommand[] = [];
    let evenOdd = false;
    for (const child of clipPath.children ?? []) {
      const childCtm = multiply(ctm, parseTransform(attr(child, 'transform')));
      const shape =
        child.tag === 'rect'
          ? this.path(rectPath(child), childCtm)
          : child.tag === 'path'
            ? this.path(attr(child, 'd'), childCtm)
            : null;
      if (!shape) continue;
      if (!path.length) evenOdd = attr(child, 'clip-rule') === 'evenodd';
      for (const command of shape) path.push(command);
    }
    if (!path.length) return false;
    this.push({ kind: 'clip', path, evenOdd }, path.length);
    return true;
  }

  /** Draw `node` and its children under `ctm`. */
  node(node: SvgTreeNode, ctm: MetafileMatrix, depth: number): void {
    if (this.exhausted || depth > MAX_DEPTH) {
      if (depth > MAX_DEPTH) this.exhausted = true;
      return;
    }
    if (node.tag === 'defs' || node.tag === 'clipPath' || /Gradient$/.test(node.tag)) return;
    const local = multiply(ctm, parseTransform(attr(node, 'transform')));
    const clipRef = attr(node, 'clip-path');
    const clipped = reference(clipRef) !== null;
    if (clipped) {
      this.push({ kind: 'save' });
      if (!this.clip(clipRef, local, depth + 1)) {
        this.push({ kind: 'restore' });
        return;
      }
    }
    const alpha = opacity(attr(node, 'opacity'));
    switch (node.tag) {
      case 'svg':
      case 'g':
        if (alpha > 0) {
          const inner = node.tag === 'svg' ? multiply(local, viewportMatrix(node)) : local;
          for (const child of node.children ?? []) this.node(child, inner, depth + 1);
        }
        break;
      case 'path':
      case 'rect':
        this.shape(node, node.tag === 'rect' ? rectPath(node) : attr(node, 'd'), local, alpha);
        break;
      case 'text':
        this.text(node, local, alpha);
        break;
      case 'image':
        this.image(node, local);
        break;
      default:
        break;
    }
    if (clipped) this.push({ kind: 'restore' });
  }

  private shape(
    node: SvgTreeNode,
    d: string | undefined,
    ctm: MetafileMatrix,
    alpha: number
  ): void {
    // SVG fills black when a shape names no fill.
    const fill = this.paint(
      attr(node, 'fill') ?? 'black',
      alpha * opacity(attr(node, 'fill-opacity'))
    );
    const stroke = this.paint(attr(node, 'stroke'), alpha * opacity(attr(node, 'stroke-opacity')));
    if (!fill && !stroke) return;
    const path = this.path(d, ctm);
    if (!path) return;
    if (fill) {
      this.push(
        { kind: 'fill', path, evenOdd: attr(node, 'fill-rule') === 'evenodd', paint: fill },
        path.length
      );
    }
    if (stroke) {
      const scale = Math.sqrt(Math.abs(ctm[0] * ctm[3] - ctm[1] * ctm[2]));
      const width = Math.max(0, number(attr(node, 'stroke-width'), 1)) * scale;
      const dashText = attr(node, 'stroke-dasharray');
      const dash =
        dashText && dashText !== 'none'
          ? dashText
              .split(/[\s,]+/)
              .filter(Boolean)
              .slice(0, 64)
              .map((part) => Math.max(0, number(part)) * scale)
          : [];
      this.push({ kind: 'stroke', path, width, dash, paint: stroke }, path.length);
    }
  }

  private text(node: SvgTreeNode, ctm: MetafileMatrix, alpha: number): void {
    const text = node.text ?? '';
    if (!text) return;
    const paint = this.paint(
      attr(node, 'fill') ?? 'black',
      alpha * opacity(attr(node, 'fill-opacity'))
    );
    if (!paint) return;
    const weight = attr(node, 'font-weight')?.trim().toLowerCase();
    const style = attr(node, 'font-style')?.trim().toLowerCase();
    const font: MetafileFont = {
      family: fontFamily(attr(node, 'font-family')),
      sizePx: Math.min(10_000, Math.max(0, number(attr(node, 'font-size'), 16))),
      bold: weight === 'bold' || weight === 'bolder' || number(weight, 400) >= 600,
      italic: style === 'italic' || style === 'oblique',
    };
    const anchor = attr(node, 'text-anchor');
    const baseline = attr(node, 'dominant-baseline');
    this.push({
      kind: 'text',
      text,
      font,
      x: number(attr(node, 'x')),
      y: number(attr(node, 'y')),
      align: anchor === 'middle' ? 'center' : anchor === 'end' ? 'right' : 'left',
      baseline:
        baseline === 'text-before-edge' || baseline === 'hanging'
          ? 'top'
          : baseline === 'text-after-edge'
            ? 'bottom'
            : baseline === 'central' || baseline === 'middle'
              ? 'middle'
              : 'alphabetic',
      matrix: ctm,
      paint,
    });
  }

  private image(node: SvgTreeNode, ctm: MetafileMatrix): void {
    const bytes = dataUrlBytes(attr(node, 'href') ?? attr(node, 'xlink:href') ?? '');
    if (!bytes) return;
    const size = encodedSize(bytes);
    if (!size || !(size.width > 0 && size.height > 0)) return;
    this.pixels += size.width * size.height;
    // A raster past the bound is refused: the exporter would expand it to RGBA.
    if (this.pixels > MAX_METAFILE_PIXELS) {
      this.exhausted = true;
      return;
    }
    const width = number(attr(node, 'width'));
    const height = number(attr(node, 'height'));
    if (!(width > 0 && height > 0)) return;
    const raster: MetafileRaster = { kind: 'encoded', ...size, bytes };
    const placed: MetafileMatrix = [
      width,
      0,
      0,
      height,
      number(attr(node, 'x')),
      number(attr(node, 'y')),
    ];
    this.push({ kind: 'image', raster, matrix: multiply(ctm, placed) });
  }
}

function rectPath(node: SvgTreeNode): string | undefined {
  const x = number(attr(node, 'x'));
  const y = number(attr(node, 'y'));
  const width = number(attr(node, 'width'));
  const height = number(attr(node, 'height'));
  if (!(width > 0 && height > 0)) return undefined;
  return `M${x} ${y}H${x + width}V${y + height}H${x}Z`;
}

/** An `<svg>`'s `viewBox` mapped onto its `x`, `y`, `width`, and `height`. */
function viewportMatrix(node: SvgTreeNode): MetafileMatrix {
  const x = number(attr(node, 'x'));
  const y = number(attr(node, 'y'));
  const box = (attr(node, 'viewBox') ?? '')
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((part) => number(part));
  if (box.length !== 4 || !(box[2]! > 0 && box[3]! > 0)) return [1, 0, 0, 1, x, y];
  const width = number(attr(node, 'width'), box[2]!);
  const height = number(attr(node, 'height'), box[3]!);
  const sx = width / box[2]!;
  const sy = height / box[3]!;
  return [sx, 0, 0, sy, x - box[0]! * sx, y - box[1]! * sy];
}

/** The drawing an `emf-converter` SVG tree describes, in pixels of its root viewport. */
export function svgTreeDrawing(root: SvgTreeNode): SvgTreeDrawing {
  const walk = new Walk(root);
  const box = (attr(root, 'viewBox') ?? '')
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((part) => number(part));
  const width = Math.max(0, number(attr(root, 'width'), box[2] ?? 0));
  const height = Math.max(0, number(attr(root, 'height'), box[3] ?? 0));
  // The root is placed at the origin; only its viewBox maps onto its size.
  walk.node({ ...root, attrs: { ...root.attrs, x: 0, y: 0 } }, IDENTITY, 0);
  return {
    drawing: { width, height, commands: walk.commands },
    exhausted: walk.exhausted,
  };
}

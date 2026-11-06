/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// SVG path data to absolute moves, lines, cubic curves, and closes.
//
// The data comes from a metafile, so it is attacker-controlled: the scanner is a single pass
// with no backtracking, keeps finite numbers only, and stops at a point bound.

/** One absolute path command in the path's own coordinates. */
export type SvgPathCommand =
  | { readonly op: 'M' | 'L'; readonly x: number; readonly y: number }
  | {
      readonly op: 'C';
      readonly x1: number;
      readonly y1: number;
      readonly x2: number;
      readonly y2: number;
      readonly x: number;
      readonly y: number;
    }
  | { readonly op: 'Z' };

const ARGUMENTS: Readonly<Record<string, number>> = {
  M: 2,
  L: 2,
  H: 1,
  V: 1,
  C: 6,
  S: 4,
  Q: 4,
  T: 2,
  A: 7,
  Z: 0,
};

/** Split path data into command letters and numbers, in one pass. */
function tokens(d: string): (string | number)[] {
  const out: (string | number)[] = [];
  const length = d.length;
  let at = 0;
  while (at < length) {
    const char = d[at]!;
    const upper = char.toUpperCase();
    if (upper in ARGUMENTS && char !== 'e' && char !== 'E') {
      out.push(char);
      at += 1;
      continue;
    }
    if (char === ' ' || char === ',' || char === '\n' || char === '\t' || char === '\r') {
      at += 1;
      continue;
    }
    // A number: sign, digits, one decimal point, and an exponent.
    let end = at;
    if (d[end] === '+' || d[end] === '-') end += 1;
    let digits = false;
    while (end < length && d[end]! >= '0' && d[end]! <= '9') {
      end += 1;
      digits = true;
    }
    if (d[end] === '.') {
      end += 1;
      while (end < length && d[end]! >= '0' && d[end]! <= '9') {
        end += 1;
        digits = true;
      }
    }
    if (!digits) return out;
    if (d[end] === 'e' || d[end] === 'E') {
      let exponent = end + 1;
      if (d[exponent] === '+' || d[exponent] === '-') exponent += 1;
      const start = exponent;
      while (exponent < length && d[exponent]! >= '0' && d[exponent]! <= '9') exponent += 1;
      if (exponent > start) end = exponent;
    }
    const value = Number(d.slice(at, end));
    if (!Number.isFinite(value)) return out;
    out.push(value);
    at = end;
  }
  return out;
}

/** An elliptical arc as cubic curves, after the SVG implementation notes (F.6). */
function arc(
  x0: number,
  y0: number,
  rxIn: number,
  ryIn: number,
  rotation: number,
  large: boolean,
  sweep: boolean,
  x: number,
  y: number
): SvgPathCommand[] {
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if ((x0 === x && y0 === y) || rx === 0 || ry === 0) return [{ op: 'L', x, y }];
  const phi = (rotation * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (x0 - x) / 2;
  const dy = (y0 - y) / 2;
  const x1 = cos * dx + sin * dy;
  const y1 = -sin * dx + cos * dy;
  const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const numerator = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const denominator = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  const root = Math.sqrt(Math.max(0, numerator / denominator)) * (large === sweep ? -1 : 1);
  const cx1 = (root * rx * y1) / ry;
  const cy1 = (-root * ry * x1) / rx;
  const cx = cos * cx1 - sin * cy1 + (x0 + x) / 2;
  const cy = sin * cx1 + cos * cy1 + (y0 + y) / 2;
  const angle = (ux: number, uy: number, vx: number, vy: number) =>
    Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const start = angle(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
  let delta = angle((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
  if (!sweep && delta > 0) delta -= Math.PI * 2;
  if (sweep && delta < 0) delta += Math.PI * 2;
  const segments = Math.min(16, Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2))));
  const step = delta / segments;
  const k = (4 / 3) * Math.tan(step / 4);
  const point = (t: number): [number, number] => [
    cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin,
    cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos,
  ];
  const derivative = (t: number): [number, number] => [
    -rx * Math.sin(t) * cos - ry * Math.cos(t) * sin,
    -rx * Math.sin(t) * sin + ry * Math.cos(t) * cos,
  ];
  const out: SvgPathCommand[] = [];
  for (let index = 0; index < segments; index += 1) {
    const t1 = start + index * step;
    const t2 = t1 + step;
    const [px1, py1] = point(t1);
    const [px2, py2] = point(t2);
    const [dx1, dy1] = derivative(t1);
    const [dx2, dy2] = derivative(t2);
    const last = index === segments - 1;
    out.push({
      op: 'C',
      x1: px1 + k * dx1,
      y1: py1 + k * dy1,
      x2: px2 - k * dx2,
      y2: py2 - k * dy2,
      x: last ? x : px2,
      y: last ? y : py2,
    });
  }
  return out;
}

/**
 * Absolute path commands for SVG path data. Stops at the first malformed command, as SVG
 * renderers do, keeping what came before. `'too-long'` when the path holds more than
 * `maxPoints` points.
 */
export function parseSvgPath(d: string, maxPoints: number): SvgPathCommand[] | 'too-long' {
  const list = tokens(d);
  const out: SvgPathCommand[] = [];
  let points = 0;
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  // The last control point, for the smooth curve commands.
  let controlX = 0;
  let controlY = 0;
  let previous = '';
  let at = 0;
  let command = '';
  const emit = (next: SvgPathCommand): boolean => {
    points += next.op === 'C' ? 3 : next.op === 'Z' ? 0 : 1;
    if (points > maxPoints) return false;
    out.push(next);
    return true;
  };
  while (at < list.length) {
    const token = list[at]!;
    if (typeof token === 'string') {
      command = token;
      at += 1;
      if (command === 'z' || command === 'Z') {
        if (!emit({ op: 'Z' })) return 'too-long';
        x = startX;
        y = startY;
        previous = 'Z';
        continue;
      }
    } else if (!command || command === 'z' || command === 'Z') {
      return out;
    }
    const upper = command.toUpperCase();
    const count = ARGUMENTS[upper]!;
    if (at + count > list.length) return out;
    const args = list.slice(at, at + count);
    if (args.some((arg) => typeof arg !== 'number')) return out;
    at += count;
    const n = args as number[];
    const relative = command !== upper;
    const ox = relative ? x : 0;
    const oy = relative ? y : 0;
    let next: SvgPathCommand[] = [];
    switch (upper) {
      case 'M':
        x = ox + n[0]!;
        y = oy + n[1]!;
        startX = x;
        startY = y;
        next = [{ op: 'M', x, y }];
        // Coordinate pairs after a move are lines.
        command = relative ? 'l' : 'L';
        break;
      case 'L':
        x = ox + n[0]!;
        y = oy + n[1]!;
        next = [{ op: 'L', x, y }];
        break;
      case 'H':
        x = ox + n[0]!;
        next = [{ op: 'L', x, y }];
        break;
      case 'V':
        y = oy + n[0]!;
        next = [{ op: 'L', x, y }];
        break;
      case 'C':
        next = [
          {
            op: 'C',
            x1: ox + n[0]!,
            y1: oy + n[1]!,
            x2: ox + n[2]!,
            y2: oy + n[3]!,
            x: ox + n[4]!,
            y: oy + n[5]!,
          },
        ];
        controlX = ox + n[2]!;
        controlY = oy + n[3]!;
        x = ox + n[4]!;
        y = oy + n[5]!;
        break;
      case 'S': {
        const smooth = previous === 'C' || previous === 'S';
        const x1 = smooth ? 2 * x - controlX : x;
        const y1 = smooth ? 2 * y - controlY : y;
        next = [{ op: 'C', x1, y1, x2: ox + n[0]!, y2: oy + n[1]!, x: ox + n[2]!, y: oy + n[3]! }];
        controlX = ox + n[0]!;
        controlY = oy + n[1]!;
        x = ox + n[2]!;
        y = oy + n[3]!;
        break;
      }
      case 'Q':
      case 'T': {
        const smooth = upper === 'T' && (previous === 'Q' || previous === 'T');
        const qx = upper === 'Q' ? ox + n[0]! : smooth ? 2 * x - controlX : x;
        const qy = upper === 'Q' ? oy + n[1]! : smooth ? 2 * y - controlY : y;
        const endX = ox + n[upper === 'Q' ? 2 : 0]!;
        const endY = oy + n[upper === 'Q' ? 3 : 1]!;
        next = [
          {
            op: 'C',
            x1: x + (2 / 3) * (qx - x),
            y1: y + (2 / 3) * (qy - y),
            x2: endX + (2 / 3) * (qx - endX),
            y2: endY + (2 / 3) * (qy - endY),
            x: endX,
            y: endY,
          },
        ];
        controlX = qx;
        controlY = qy;
        x = endX;
        y = endY;
        break;
      }
      case 'A': {
        const endX = ox + n[5]!;
        const endY = oy + n[6]!;
        next = arc(x, y, n[0]!, n[1]!, n[2]!, n[3] !== 0, n[4] !== 0, endX, endY);
        x = endX;
        y = endY;
        break;
      }
      default:
        return out;
    }
    previous = upper;
    for (const item of next) if (!emit(item)) return 'too-long';
  }
  return out;
}

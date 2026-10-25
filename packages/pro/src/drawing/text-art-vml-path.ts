/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A VML path (`v:shapetype/@path`, `v:shape/@path`) traced to polylines in its coordinate
// space: straight segments, Bezier curves, elliptical quadrants and the four arc forms. A text
// path shape lays its text along these subpaths.
//
// Every value comes from the file, so the path length, the point count and the curve steps
// are bounded, and anything unknown returns null rather than a guess.

/** A point in the path's coordinate space. */
export interface PathPoint {
  readonly x: number;
  readonly y: number;
}

/** One traced subpath. */
export interface TracedSubpath {
  readonly points: readonly PathPoint[];
  readonly closed: boolean;
}

const MAX_PATH_LENGTH = 4096;
const MAX_POINTS = 4096;
/** Line segments per curve or quarter turn of an arc. */
const CURVE_STEPS = 24;
/** VML angles are fixed-point degrees: 65536 units per degree. */
const FD = 65536;

const ARITY: ReadonlyMap<string, number> = new Map([
  ['m', 2],
  ['l', 2],
  ['r', 2],
  ['t', 2],
  ['c', 6],
  ['v', 6],
  ['x', 0],
  ['e', 0],
  ['nf', 0],
  ['ns', 0],
  ['ae', 6],
  ['al', 6],
  ['at', 8],
  ['ar', 8],
  ['wa', 8],
  ['wr', 8],
  ['qx', 2],
  ['qy', 2],
]);

/** One value: a number, an empty slot (0), or `@n`. NaN when unknown. */
function coordinate(token: string, formulas: readonly number[]): number {
  const value = token.trim();
  if (value === '') return 0;
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  const reference = /^@(\d{1,3})$/.exec(value);
  if (reference) {
    const index = Number(reference[1]);
    return index < formulas.length ? formulas[index]! : NaN;
  }
  return NaN;
}

/**
 * The values of one operand run. Commas separate values and an empty slot is 0; spaces
 * separate them too, and a `@` or `-` after a digit starts the next value (`0@0` is two).
 */
function operands(run: string): string[] {
  if (run.trim() === '') return [];
  const spaced = run.replace(/(\d)(?=[@-])/g, '$1 ');
  return spaced.split(',').flatMap((piece) => {
    const value = piece.trim();
    return value === '' ? [''] : value.split(/\s+/);
  });
}

/** Commands in order, each with its numbers; null when the path leaves the grammar. */
function commands(
  path: string,
  formulas: readonly number[]
): { op: string; values: number[] }[] | null {
  const tokens = (path.match(/[a-z]+|[^a-z]+/gi) ?? []).flatMap((token) =>
    /^[a-z]/i.test(token) ? (token.match(/n[fs]|a[elrt]|w[ar]|q[xy]|[a-z]/gi) ?? []) : [token]
  );
  const out: { op: string; values: number[] }[] = [];
  for (let index = 0; index < tokens.length; index++) {
    const op = tokens[index]!.toLowerCase();
    const arity = ARITY.get(op);
    if (arity === undefined) return null;
    const next = tokens[index + 1];
    let values: number[] = [];
    if (next !== undefined && !/^[a-z]/i.test(next)) {
      index++;
      values = operands(next).map((token) => coordinate(token, formulas));
    }
    if (!values.every(Number.isFinite)) return null;
    if (arity === 0 ? values.length : !values.length || values.length % arity) return null;
    out.push({ op, values });
  }
  return out;
}

/**
 * The subpaths of a VML path in its coordinate space, or null when it cannot be traced.
 * `formulas` holds the template's formula values for `@n`.
 */
export function traceVmlPath(
  path: string,
  formulas: readonly number[]
): readonly TracedSubpath[] | null {
  if (path.length > MAX_PATH_LENGTH) return null;
  const list = commands(path, formulas);
  if (!list) return null;
  const subpaths: TracedSubpath[] = [];
  let current: PathPoint[] = [];
  let pen: PathPoint = { x: 0, y: 0 };
  let count = 0;
  let overflow = false;
  const flush = (closed: boolean) => {
    if (current.length > 1)
      subpaths.push(Object.freeze({ points: Object.freeze(current), closed }));
    current = [];
  };
  const add = (point: PathPoint) => {
    if (++count > MAX_POINTS) overflow = true;
    if (!current.length) current.push(pen);
    current.push(point);
    pen = point;
  };
  const moveTo = (point: PathPoint) => {
    flush(false);
    pen = point;
    current.push(pen);
  };
  // An arc of the ellipse centred at (cx, cy) with radii (rx, ry), from `start` turning by
  // `sweep` radians, where an angle runs counterclockwise on the page (y down). The sweep is
  // file data, so a turn that needs more points than are left overflows before tracing.
  const arc = (cx: number, cy: number, rx: number, ry: number, start: number, sweep: number) => {
    const steps = Math.max(1, Math.ceil((Math.abs(sweep) / (Math.PI / 2)) * CURVE_STEPS));
    if (!(count + steps <= MAX_POINTS)) {
      overflow = true;
      return;
    }
    for (let step = 1; step <= steps && !overflow; step++) {
      const angle = start + (sweep * step) / steps;
      add({ x: cx + rx * Math.cos(angle), y: cy - ry * Math.sin(angle) });
    }
  };
  const arcStart = (cx: number, cy: number, rx: number, ry: number, angle: number) => ({
    x: cx + rx * Math.cos(angle),
    y: cy - ry * Math.sin(angle),
  });
  for (const { op, values } of list) {
    const arity = ARITY.get(op)!;
    const groups = arity ? values.length / arity : 1;
    for (let g = 0; g < groups; g++) {
      const v = values.slice(g * arity, (g + 1) * arity);
      switch (op) {
        case 'm':
          moveTo({ x: v[0]!, y: v[1]! });
          break;
        case 't':
          moveTo({ x: pen.x + v[0]!, y: pen.y + v[1]! });
          break;
        case 'l':
          add({ x: v[0]!, y: v[1]! });
          break;
        case 'r':
          add({ x: pen.x + v[0]!, y: pen.y + v[1]! });
          break;
        case 'c':
        case 'v': {
          const base = op === 'v' ? pen : { x: 0, y: 0 };
          const p0 = pen;
          const [x1, y1, x2, y2, x3, y3] = v.map((value, i) => value + (i % 2 ? base.y : base.x));
          for (let step = 1; step <= CURVE_STEPS; step++) {
            const t = step / CURVE_STEPS,
              u = 1 - t;
            add({
              x: u * u * u * p0.x + 3 * u * u * t * x1! + 3 * u * t * t * x2! + t * t * t * x3!,
              y: u * u * u * p0.y + 3 * u * u * t * y1! + 3 * u * t * t * y2! + t * t * t * y3!,
            });
          }
          break;
        }
        case 'ae':
        case 'al': {
          const [cx, cy, rx, ry, start, sweep] = v as [
            number,
            number,
            number,
            number,
            number,
            number,
          ];
          const a0 = ((start / FD) * Math.PI) / 180,
            a1 = ((sweep / FD) * Math.PI) / 180;
          const first = arcStart(cx, cy, rx, ry, a0);
          if (op === 'al') moveTo(first);
          else add(first);
          arc(cx, cy, rx, ry, a0, a1);
          break;
        }
        case 'at':
        case 'ar':
        case 'wa':
        case 'wr': {
          const [left, top, right, bottom, x1, y1, x2, y2] = v as number[];
          const cx = (left! + right!) / 2,
            cy = (top! + bottom!) / 2;
          const rx = Math.abs(right! - left!) / 2,
            ry = Math.abs(bottom! - top!) / 2;
          if (!(rx > 0 && ry > 0)) return null;
          // The radial vectors to the two points name the angles, on the unit circle the
          // ellipse is scaled from.
          const angle = (x: number, y: number) => Math.atan2(-(y - cy) / ry, (x - cx) / rx);
          const a0 = angle(x1!, y1!);
          let a1 = angle(x2!, y2!);
          // `at` and `ar` turn counterclockwise, `wa` and `wr` clockwise.
          const clockwise = op === 'wa' || op === 'wr';
          if (clockwise) while (a1 >= a0) a1 -= 2 * Math.PI;
          else while (a1 <= a0) a1 += 2 * Math.PI;
          const first = arcStart(cx, cy, rx, ry, a0);
          if (op === 'ar' || op === 'wr') moveTo(first);
          else add(first);
          arc(cx, cy, rx, ry, a0, a1 - a0);
          break;
        }
        case 'qx':
        case 'qy': {
          // Quadrants alternate their first tangent: `qx` leaves along x, then the next pair
          // leaves along y, and so on.
          const alongX = (op === 'qx') === (g % 2 === 0);
          const from = pen;
          const to = { x: v[0]!, y: v[1]! };
          for (let step = 1; step <= CURVE_STEPS; step++) {
            const t = ((step / CURVE_STEPS) * Math.PI) / 2;
            add(
              alongX
                ? {
                    x: from.x + (to.x - from.x) * Math.sin(t),
                    y: to.y + (from.y - to.y) * Math.cos(t),
                  }
                : {
                    x: to.x + (from.x - to.x) * Math.cos(t),
                    y: from.y + (to.y - from.y) * Math.sin(t),
                  }
            );
          }
          break;
        }
        case 'x':
          if (current.length) pen = current[0]!;
          flush(true);
          break;
        case 'e':
          flush(false);
          break;
        default:
          // `nf` and `ns` only switch fill and outline off.
          break;
      }
      if (overflow) return null;
    }
  }
  flush(false);
  return Object.freeze(subpaths);
}

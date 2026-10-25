/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A recording stand-in for the canvas 2D API, so a metafile replay yields vector drawing
// commands instead of pixels. Only the calls the metafile replayer makes are modelled.
//
// Every value the replayer passes comes from attacker-controlled metafile bytes. The recorder
// keeps finite numbers only, bounds commands, path points, and raster pixels, and stops
// recording once a bound is reached.

import type {
  MetafileCommand,
  MetafileDrawing,
  MetafileFont,
  MetafileMatrix,
  MetafilePaint,
  MetafilePathCommand,
  MetafileRaster,
} from '@docx-editor.dev/core/store';

export type {
  MetafileCommand,
  MetafileDrawing,
  MetafileFont,
  MetafileMatrix,
  MetafilePaint,
  MetafilePathCommand,
  MetafileRaster,
};

/** Shared bounds across one replay and every canvas it creates. */
export interface MetafileBudget {
  commands: number;
  points: number;
  pixels: number;
  /** Set once a bound stops recording; the drawing is then incomplete. */
  exhausted: boolean;
}

export const MAX_METAFILE_COMMANDS = 200_000;
export const MAX_METAFILE_POINTS = 2_000_000;
export const MAX_METAFILE_PIXELS = 16_000_000;

const IDENTITY: MetafileMatrix = [1, 0, 0, 1, 0, 0];
const BLACK: MetafilePaint = { r: 0, g: 0, b: 0, alpha: 1 };
const TAU = Math.PI * 2;

const finite = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;

function multiply(m: MetafileMatrix, n: MetafileMatrix): MetafileMatrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

/** A CSS color the replayer writes: `#rgb`, `#rrggbb`, `rgb()`, `rgba()`, or a few names. */
export function parseCanvasColor(value: unknown): MetafilePaint | null {
  if (value instanceof RecordingGradient) return value.mean();
  if (typeof value !== 'string') return null;
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

/**
 * The face name with the four LOGFONT bytes before it removed, when the replayer read them
 * as part of the name. Those bytes are the output precision (0–10), clip precision flags, the
 * quality (0–6), and the pitch and family byte (pitch 0–2, family 0–5), so the two UTF-16 units
 * they make have a shape no face name starts with.
 */
function repairFaceName(face: string): string {
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

/** `italic bold 12px "Face Name"`, as the replayer writes `font`. */
export function parseCanvasFont(value: string): MetafileFont {
  const match = /^\s*(italic\s+)?(?:(bold|[1-9]00)\s+)?([\d.]+)px\s+(.+?)\s*$/i.exec(value);
  if (!match) return { family: 'Arial', sizePx: 10, bold: false, italic: false };
  const weight = match[2]?.toLowerCase();
  const family = repairFaceName(
    match[4]!
      .split(',')[0]!
      .trim()
      .replace(/^["']|["']$/g, '')
  );
  return {
    family: family || 'Arial',
    sizePx: Math.min(10_000, Math.max(0, Number(match[3]) || 0)),
    bold: weight === 'bold' || (weight !== undefined && Number(weight) >= 600),
    italic: match[1] !== undefined,
  };
}

/** A gradient the replayer builds; it paints as the mean of its stops. */
export class RecordingGradient {
  private readonly stops: MetafilePaint[] = [];
  addColorStop(_offset: number, color: string): void {
    const paint = parseCanvasColor(color);
    if (paint && this.stops.length < 256) this.stops.push(paint);
  }
  mean(): MetafilePaint {
    if (!this.stops.length) return BLACK;
    const sum = (key: keyof MetafilePaint) =>
      this.stops.reduce((total, stop) => total + stop[key], 0) / this.stops.length;
    return { r: sum('r'), g: sum('g'), b: sum('b'), alpha: sum('alpha') };
  }
}

/** The image data the replayer decodes bitmaps into. */
export class RecordingImageData {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
  constructor(dataOrWidth: Uint8ClampedArray | number, width: number, height?: number) {
    if (typeof dataOrWidth === 'number') {
      this.width = Math.max(0, Math.floor(dataOrWidth));
      this.height = Math.max(0, Math.floor(width));
      this.data = new Uint8ClampedArray(this.width * this.height * 4);
    } else {
      this.data = dataOrWidth;
      this.width = Math.max(0, Math.floor(width));
      this.height = Math.max(0, Math.floor(height ?? dataOrWidth.length / 4 / Math.max(1, width)));
    }
  }
}

/** A decoded image the replayer draws: an encoded raster, or a nested recorded drawing. */
export interface RecordingBitmap {
  readonly width: number;
  readonly height: number;
  readonly raster?: MetafileRaster;
  readonly drawing?: MetafileDrawing;
  close(): void;
}

interface DrawState {
  matrix: MetafileMatrix;
  fillStyle: unknown;
  strokeStyle: unknown;
  lineWidth: number;
  dash: number[];
  font: string;
  textAlign: string;
  textBaseline: string;
  globalAlpha: number;
}

/** The 2D context a recording canvas hands out. */
export class RecordingContext2D {
  readonly commands: MetafileCommand[] = [];
  private state: DrawState = {
    matrix: IDENTITY,
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1,
    dash: [],
    font: '10px Arial',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    globalAlpha: 1,
  };
  private readonly stack: DrawState[] = [];
  private path: MetafilePathCommand[] = [];
  /** The current point in user space, for `arcTo`. */
  private current: { x: number; y: number } | null = null;
  private start: { x: number; y: number } | null = null;
  // Accepted and ignored: the replayer may set them; vector output does not need them.
  globalCompositeOperation = 'source-over';
  lineCap = 'butt';
  lineJoin = 'miter';
  miterLimit = 10;
  imageSmoothingEnabled = true;
  lineDashOffset = 0;

  constructor(
    readonly canvas: RecordingCanvas,
    private readonly budget: MetafileBudget,
    private readonly measure: (text: string, font: MetafileFont) => number
  ) {}

  get fillStyle(): unknown {
    return this.state.fillStyle;
  }
  set fillStyle(value: unknown) {
    this.state.fillStyle = value;
  }
  get strokeStyle(): unknown {
    return this.state.strokeStyle;
  }
  set strokeStyle(value: unknown) {
    this.state.strokeStyle = value;
  }
  get lineWidth(): number {
    return this.state.lineWidth;
  }
  set lineWidth(value: number) {
    if (Number.isFinite(value) && value > 0) this.state.lineWidth = value;
  }
  get font(): string {
    return this.state.font;
  }
  set font(value: string) {
    if (typeof value === 'string' && value.length < 512) this.state.font = value;
  }
  get textAlign(): string {
    return this.state.textAlign;
  }
  set textAlign(value: string) {
    this.state.textAlign = String(value);
  }
  get textBaseline(): string {
    return this.state.textBaseline;
  }
  set textBaseline(value: string) {
    this.state.textBaseline = String(value);
  }
  get globalAlpha(): number {
    return this.state.globalAlpha;
  }
  set globalAlpha(value: number) {
    if (Number.isFinite(value)) this.state.globalAlpha = Math.max(0, Math.min(1, value));
  }

  /**
   * Whether `points` more path points fit the budget. Checked before a path is copied into a
   * command, so a stream that repeats a large path stops costing work once the budget ends.
   */
  private admits(points: number): boolean {
    if (this.budget.exhausted) return false;
    if (this.budget.points + points > MAX_METAFILE_POINTS) {
      this.budget.exhausted = true;
      return false;
    }
    return true;
  }

  /** Extend the current path; path building stops with the budget too. */
  private extend(command: MetafilePathCommand): void {
    if (!this.admits(this.path.length + 1)) return;
    this.path.push(command);
  }

  private push(command: MetafileCommand, points = 0): void {
    if (this.budget.exhausted) return;
    this.budget.commands += 1;
    this.budget.points += points;
    if (this.budget.commands > MAX_METAFILE_COMMANDS || this.budget.points > MAX_METAFILE_POINTS) {
      this.budget.exhausted = true;
      return;
    }
    this.commands.push(command);
  }

  private paintOf(style: unknown): MetafilePaint | null {
    const paint = parseCanvasColor(style);
    if (!paint) return null;
    const alpha = paint.alpha * this.state.globalAlpha;
    return alpha > 0 ? { ...paint, alpha } : null;
  }

  private device(x: number, y: number): { x: number; y: number } {
    const m = this.state.matrix;
    const px = finite(x);
    const py = finite(y);
    return { x: m[0] * px + m[2] * py + m[4], y: m[1] * px + m[3] * py + m[5] };
  }

  /** The pen scale of the current transform, for stroke widths and dashes. */
  private penScale(): number {
    const m = this.state.matrix;
    return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
  }

  save(): void {
    if (this.stack.length >= 256) return;
    this.stack.push({ ...this.state, dash: [...this.state.dash] });
    this.push({ kind: 'save' });
  }
  restore(): void {
    const previous = this.stack.pop();
    if (!previous) return;
    this.state = previous;
    this.push({ kind: 'restore' });
  }
  setTransform(a: unknown, b?: number, c?: number, d?: number, e?: number, f?: number): void {
    if (typeof a === 'object' && a !== null) {
      const m = a as Record<string, unknown>;
      this.state.matrix = [m.a, m.b, m.c, m.d, m.e, m.f].map(finite) as unknown as MetafileMatrix;
      return;
    }
    this.state.matrix = [a, b, c, d, e, f].map(finite) as unknown as MetafileMatrix;
  }
  resetTransform(): void {
    this.state.matrix = IDENTITY;
  }
  transform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    const n = [a, b, c, d, e, f].map(finite) as unknown as MetafileMatrix;
    this.state.matrix = multiply(this.state.matrix, n);
  }
  translate(x: number, y: number): void {
    this.transform(1, 0, 0, 1, x, y);
  }
  scale(x: number, y: number): void {
    this.transform(x, 0, 0, y, 0, 0);
  }
  rotate(angle: number): void {
    const cos = Math.cos(finite(angle));
    const sin = Math.sin(finite(angle));
    this.transform(cos, sin, -sin, cos, 0, 0);
  }
  getTransform(): { a: number; b: number; c: number; d: number; e: number; f: number } {
    const [a, b, c, d, e, f] = this.state.matrix;
    return { a, b, c, d, e, f };
  }
  setLineDash(segments: readonly number[]): void {
    if (!Array.isArray(segments) || segments.length > 64) return;
    this.state.dash = segments.map(finite).map((value) => Math.max(0, value));
  }
  getLineDash(): number[] {
    return [...this.state.dash];
  }

  beginPath(): void {
    this.path = [];
    this.current = null;
    this.start = null;
  }
  moveTo(x: number, y: number): void {
    this.extend({ op: 'M', ...this.device(x, y) });
    this.current = { x: finite(x), y: finite(y) };
    this.start = this.current;
  }
  lineTo(x: number, y: number): void {
    if (!this.current) return this.moveTo(x, y);
    this.extend({ op: 'L', ...this.device(x, y) });
    this.current = { x: finite(x), y: finite(y) };
  }
  bezierCurveTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number): void {
    if (!this.current) this.moveTo(x1, y1);
    const a = this.device(x1, y1);
    const b = this.device(x2, y2);
    const end = this.device(x, y);
    this.extend({ op: 'C', x1: a.x, y1: a.y, x2: b.x, y2: b.y, x: end.x, y: end.y });
    this.current = { x: finite(x), y: finite(y) };
  }
  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void {
    const from = this.current ?? { x: finite(cx), y: finite(cy) };
    this.bezierCurveTo(
      from.x + (2 / 3) * (finite(cx) - from.x),
      from.y + (2 / 3) * (finite(cy) - from.y),
      finite(x) + (2 / 3) * (finite(cx) - finite(x)),
      finite(y) + (2 / 3) * (finite(cy) - finite(y)),
      x,
      y
    );
  }
  closePath(): void {
    if (!this.current) return;
    this.extend({ op: 'Z' });
    this.current = this.start;
  }
  rect(x: number, y: number, w: number, h: number): void {
    this.moveTo(x, y);
    this.lineTo(finite(x) + finite(w), y);
    this.lineTo(finite(x) + finite(w), finite(y) + finite(h));
    this.lineTo(x, finite(y) + finite(h));
    this.closePath();
  }
  arc(x: number, y: number, r: number, start: number, end: number, ccw = false): void {
    this.ellipse(x, y, r, r, 0, start, end, ccw);
  }
  ellipse(
    x: number,
    y: number,
    rx: number,
    ry: number,
    rotation: number,
    start: number,
    end: number,
    ccw = false
  ): void {
    const [cx, cy, a, b, turn, from] = [x, y, rx, ry, rotation, start].map(finite) as [
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    if (a < 0 || b < 0) return;
    let sweep = finite(end) - from;
    if (!ccw) sweep = sweep >= TAU ? TAU : ((sweep % TAU) + TAU) % TAU;
    else sweep = -sweep >= TAU ? -TAU : -(((-sweep % TAU) + TAU) % TAU);
    const cos = Math.cos(turn);
    const sin = Math.sin(turn);
    const at = (angle: number) => {
      const ex = a * Math.cos(angle);
      const ey = b * Math.sin(angle);
      return { x: cx + ex * cos - ey * sin, y: cy + ex * sin + ey * cos };
    };
    const first = at(from);
    if (this.current) this.lineTo(first.x, first.y);
    else this.moveTo(first.x, first.y);
    const steps = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2)));
    const step = sweep / steps;
    // Each quarter or smaller arc as one cubic: control arms of (4/3)·tan(step/4).
    const k = (4 / 3) * Math.tan(step / 4);
    for (let index = 0; index < steps; index += 1) {
      const t0 = from + step * index;
      const t1 = t0 + step;
      const p0 = at(t0);
      const p1 = at(t1);
      const d0 = { x: -a * Math.sin(t0), y: b * Math.cos(t0) };
      const d1 = { x: -a * Math.sin(t1), y: b * Math.cos(t1) };
      const turnVector = (v: { x: number; y: number }) => ({
        x: v.x * cos - v.y * sin,
        y: v.x * sin + v.y * cos,
      });
      const t0v = turnVector(d0);
      const t1v = turnVector(d1);
      this.bezierCurveTo(
        p0.x + k * t0v.x,
        p0.y + k * t0v.y,
        p1.x - k * t1v.x,
        p1.y - k * t1v.y,
        p1.x,
        p1.y
      );
    }
  }
  arcTo(x1: number, y1: number, x2: number, y2: number, radius: number): void {
    const r = finite(radius);
    if (!this.current) this.moveTo(x1, y1);
    const p0 = this.current!;
    const p1 = { x: finite(x1), y: finite(y1) };
    const p2 = { x: finite(x2), y: finite(y2) };
    const v1 = { x: p0.x - p1.x, y: p0.y - p1.y };
    const v2 = { x: p2.x - p1.x, y: p2.y - p1.y };
    const l1 = Math.hypot(v1.x, v1.y);
    const l2 = Math.hypot(v2.x, v2.y);
    const cross = v1.x * v2.y - v1.y * v2.x;
    if (r <= 0 || l1 === 0 || l2 === 0 || Math.abs(cross) < 1e-12 * l1 * l2) {
      this.lineTo(p1.x, p1.y);
      return;
    }
    const angle = Math.acos(Math.max(-1, Math.min(1, (v1.x * v2.x + v1.y * v2.y) / (l1 * l2))));
    const tangent = r / Math.tan(angle / 2);
    const t1 = { x: p1.x + (v1.x / l1) * tangent, y: p1.y + (v1.y / l1) * tangent };
    const t2 = { x: p1.x + (v2.x / l2) * tangent, y: p1.y + (v2.y / l2) * tangent };
    const bisector = { x: v1.x / l1 + v2.x / l2, y: v1.y / l1 + v2.y / l2 };
    const length = Math.hypot(bisector.x, bisector.y);
    const distance = r / Math.sin(angle / 2);
    const centre = {
      x: p1.x + (bisector.x / length) * distance,
      y: p1.y + (bisector.y / length) * distance,
    };
    const from = Math.atan2(t1.y - centre.y, t1.x - centre.x);
    let sweep = Math.atan2(t2.y - centre.y, t2.x - centre.x) - from;
    if (sweep > Math.PI) sweep -= TAU;
    if (sweep < -Math.PI) sweep += TAU;
    this.lineTo(t1.x, t1.y);
    this.ellipse(centre.x, centre.y, r, r, 0, from, from + sweep, sweep < 0);
  }

  fill(rule?: unknown): void {
    const paint = this.paintOf(this.state.fillStyle);
    if (!paint || !this.path.length || !this.admits(this.path.length)) return;
    this.push(
      { kind: 'fill', path: [...this.path], evenOdd: rule === 'evenodd', paint },
      this.path.length
    );
  }
  stroke(): void {
    const paint = this.paintOf(this.state.strokeStyle);
    if (!paint || !this.path.length || !this.admits(this.path.length)) return;
    const scale = this.penScale();
    this.push(
      {
        kind: 'stroke',
        path: [...this.path],
        width: this.state.lineWidth * scale,
        dash: this.state.dash.map((length) => length * scale),
        paint,
      },
      this.path.length
    );
  }
  clip(rule?: unknown): void {
    if (!this.admits(this.path.length)) return;
    this.push(
      { kind: 'clip', path: [...this.path], evenOdd: rule === 'evenodd' },
      this.path.length
    );
  }
  fillRect(x: number, y: number, w: number, h: number): void {
    const saved = { path: this.path, current: this.current, start: this.start };
    this.beginPath();
    this.rect(x, y, w, h);
    this.fill();
    Object.assign(this, saved);
  }
  strokeRect(x: number, y: number, w: number, h: number): void {
    const saved = { path: this.path, current: this.current, start: this.start };
    this.beginPath();
    this.rect(x, y, w, h);
    this.stroke();
    Object.assign(this, saved);
  }
  clearRect(): void {}

  measureText(text: string): { width: number } {
    return { width: this.measure(String(text), parseCanvasFont(this.state.font)) };
  }
  fillText(text: string, x: number, y: number): void {
    const paint = this.paintOf(this.state.fillStyle);
    const value = String(text);
    if (!paint || !value || value.length > 10_000) return;
    const align = this.state.textAlign;
    const baseline = this.state.textBaseline;
    this.push(
      {
        kind: 'text',
        text: value,
        font: parseCanvasFont(this.state.font),
        x: finite(x),
        y: finite(y),
        align:
          align === 'center' ? 'center' : align === 'right' || align === 'end' ? 'right' : 'left',
        baseline:
          baseline === 'top' || baseline === 'hanging'
            ? 'top'
            : baseline === 'bottom' || baseline === 'ideographic'
              ? 'bottom'
              : baseline === 'middle'
                ? 'middle'
                : 'alphabetic',
        matrix: this.state.matrix,
        paint,
      },
      value.length
    );
  }

  putImageData(image: RecordingImageData, dx: number, dy: number): void {
    const width = Math.floor(finite(image?.width));
    const height = Math.floor(finite(image?.height));
    if (!(width > 0 && height > 0) || !image.data || image.data.length < width * height * 4) return;
    this.budget.pixels += width * height;
    if (this.budget.pixels > MAX_METAFILE_PIXELS) {
      this.budget.exhausted = true;
      return;
    }
    // putImageData ignores the transform.
    this.push({
      kind: 'image',
      raster: { kind: 'rgba', width, height, data: Uint8Array.from(image.data) },
      matrix: [width, 0, 0, height, finite(dx), finite(dy)],
    });
  }
  getImageData(_x: number, _y: number, w: number, h: number): RecordingImageData {
    return new RecordingImageData(
      Math.min(4096, Math.max(0, finite(w))),
      Math.min(4096, finite(h))
    );
  }
  createImageData(w: number, h: number): RecordingImageData {
    return new RecordingImageData(
      Math.min(4096, Math.max(0, finite(w))),
      Math.min(4096, finite(h))
    );
  }
  createLinearGradient(): RecordingGradient {
    return new RecordingGradient();
  }
  createRadialGradient(): RecordingGradient {
    return new RecordingGradient();
  }
  createPattern(): null {
    return null;
  }

  drawImage(source: unknown, ...args: number[]): void {
    const content = drawableOf(source);
    if (!content) return;
    let [dx, dy, dw, dh] = [args[0], args[1], content.width, content.height].map(finite) as [
      number,
      number,
      number,
      number,
    ];
    if (args.length === 4) [dx, dy, dw, dh] = args.map(finite) as [number, number, number, number];
    let sourceRect: [number, number, number, number] | null = null;
    if (args.length >= 8) {
      sourceRect = args.slice(0, 4).map(finite) as [number, number, number, number];
      [dx, dy, dw, dh] = args.slice(4, 8).map(finite) as [number, number, number, number];
    }
    if (dw === 0 || dh === 0) return;
    let place: MetafileMatrix = multiply(this.state.matrix, [dw, 0, 0, dh, dx, dy]);
    if (sourceRect) {
      // A source rectangle shows only part of the image: scale the whole image so that part
      // fills the destination, and clip to the destination.
      const [sx, sy, sw, sh] = sourceRect;
      if (!(sw > 0 && sh > 0)) return;
      this.save();
      this.beginPath();
      this.rect(dx, dy, dw, dh);
      this.clip();
      place = multiply(this.state.matrix, [
        (dw * content.width) / sw,
        0,
        0,
        (dh * content.height) / sh,
        dx - (sx * dw) / sw,
        dy - (sy * dh) / sh,
      ]);
    }
    if (content.raster) this.push({ kind: 'image', raster: content.raster, matrix: place });
    else if (content.drawing) {
      this.push({
        kind: 'drawing',
        drawing: content.drawing,
        matrix: multiply(place, [1 / content.width, 0, 0, 1 / content.height, 0, 0]),
      });
    }
    if (sourceRect) this.restore();
  }
}

/** What a canvas or decoded bitmap holds, for `drawImage`. */
function drawableOf(
  source: unknown
): { width: number; height: number; raster?: MetafileRaster; drawing?: MetafileDrawing } | null {
  if (source instanceof RecordingCanvas) {
    const drawing = source.drawing();
    if (!(drawing.width > 0 && drawing.height > 0)) return null;
    // A canvas that holds only one full-size raster is that raster.
    const [only] = drawing.commands;
    if (
      drawing.commands.length === 1 &&
      only!.kind === 'image' &&
      only.raster.width === drawing.width &&
      only.raster.height === drawing.height &&
      only.matrix[0] === drawing.width &&
      only.matrix[3] === drawing.height &&
      only.matrix[4] === 0 &&
      only.matrix[5] === 0
    ) {
      return { width: drawing.width, height: drawing.height, raster: only.raster };
    }
    return { width: drawing.width, height: drawing.height, drawing };
  }
  if (source && typeof source === 'object' && 'width' in source && 'height' in source) {
    const bitmap = source as RecordingBitmap;
    if (!(bitmap.width > 0 && bitmap.height > 0)) return null;
    if (bitmap.raster) return { width: bitmap.width, height: bitmap.height, raster: bitmap.raster };
    if (bitmap.drawing) {
      return { width: bitmap.width, height: bitmap.height, drawing: bitmap.drawing };
    }
  }
  return null;
}

/** The recording stand-in for `OffscreenCanvas`. */
export class RecordingCanvas {
  private context: RecordingContext2D | null = null;
  constructor(
    public width: number,
    public height: number,
    private readonly budget: MetafileBudget,
    private readonly measure: (text: string, font: MetafileFont) => number,
    private readonly onExport: (canvas: RecordingCanvas) => string
  ) {}
  getContext(kind: string): RecordingContext2D | null {
    if (kind !== '2d') return null;
    this.context ??= new RecordingContext2D(this, this.budget, this.measure);
    return this.context;
  }
  drawing(): MetafileDrawing {
    return {
      width: Math.max(0, finite(this.width)),
      height: Math.max(0, finite(this.height)),
      commands: this.context?.commands ?? [],
    };
  }
  /** Export hands back a token naming this recording, in place of PNG bytes. */
  async convertToBlob(): Promise<Blob> {
    return new Blob([this.onExport(this)], { type: RECORDING_MIME });
  }
}

/** The blob type a recording exports as; its text is the recording's token. */
export const RECORDING_MIME = 'application/x-docx-metafile-recording';

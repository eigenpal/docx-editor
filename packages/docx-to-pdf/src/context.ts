/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { ExportResourceError } from '@docx-editor.dev/core/export';
import type { PdfDiagnostic } from './types.ts';
import type { LayoutBox } from '@docx-editor.dev/core/layout';
import { deflateSync } from 'node:zlib';
import type { PDFContext, PDFPage, PDFRawStream } from 'pdf-lib';

export const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
export const MAX_OPERATIONS = 2_000_000;
export function positiveLimit(value: number, maximum: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum)
    throw new RangeError(`${name} must be an integer from 1 to ${maximum}`);
  return value;
}
export function number(value: number): string {
  if (!Number.isFinite(value) || Math.abs(value) > 1_000_000)
    throw new RangeError('Invalid PDF coordinate');
  return String(Number(value.toFixed(6)));
}
/**
 * Device grid the reference paints filled rectangles on: 1/300 inch, the same grid
 * `text.ts` snaps baselines to. Measured, not guessed: every edge of every filled
 * rectangle in the reference PDFs lands on it — 5348 of 5348 thin-rule edges and 380 of
 * 384 larger fill edges across seventeen documents.
 */
const PAINT_GRID_PT = 0.24;

const onGrid = (value: number): number => Math.round(value / PAINT_GRID_PT) * PAINT_GRID_PT;

/**
 * A filled rectangle in PDF user space.
 *
 * `grid` rounds the ORIGIN to the grid and takes the EXTENT DOWN to it, which is what the
 * reference does: an authored 0.5pt border paints 0.48, 1pt paints 0.96 and 4pt paints
 * 3.84. Rounding both edges instead would make a border's painted thickness depend on
 * where it happens to sit, which the reference's thicknesses show it does not.
 *
 * The origin is a finished absolute position, rounded exactly once, so nothing accumulates
 * and layout cannot move. That is the distinction that matters: the same snap applied to a
 * quantity later SUMMED (a per-line height) regresses badly, and applied to how a mark is
 * drawn rather than where it sits it is a wash. See
 * `.cache/pdf/claude-picbullet/FONT-GRID-FINDING.md`.
 *
 * A rectangle that had extent keeps at least one grid unit of it, so a hairline thinner
 * than the grid cannot collapse to nothing.
 */
export function rect(box: LayoutBox, x: number, y: number, height: number, grid = false): string {
  const left = box.x + x;
  const bottom = height - box.y - y - box.height;
  if (!grid)
    return `${number(left)} ${number(bottom)} ${number(box.width)} ${number(box.height)} re`;
  const extent = (value: number): number =>
    value > 0 ? Math.max(PAINT_GRID_PT, Math.floor(value / PAINT_GRID_PT) * PAINT_GRID_PT) : 0;
  return `${number(onGrid(left))} ${number(onGrid(bottom))} ${number(extent(box.width))} ${number(extent(box.height))} re`;
}
/**
 * A hyperlink target as the content of a PDF literal string, or `null` to write no link.
 *
 * `PDFString.of` writes `(value)` with no escaping at all, so a `)` inside a file-supplied
 * href closes the string and everything after it is raw PDF inside the action dictionary:
 * `https://x/) /S /JavaScript /JS (...` would do exactly that. The scheme allowlist does not
 * stop it. The three bytes a literal string cannot carry bare — `\`, `(`, `)` — are escaped
 * as PDF defines, and a target with anything outside printable ASCII is refused rather than
 * approximated: a URI is ASCII by definition, and the alternatives are not links.
 */
export function pdfLiteralUri(href: string): string | null {
  if (href.length === 0 || href.length > 2048) return null;
  for (let index = 0; index < href.length; index += 1) {
    const code = href.charCodeAt(index);
    if (code < 0x20 || code > 0x7e) return null;
  }
  return href.replace(/[\\()]/g, (character) => `\\${character}`);
}
/**
 * A `FlateDecode` stream compressed by the runtime's native zlib. pdf-lib's `flateStream` runs
 * the same algorithm in JavaScript, which was most of the time spent writing a long document's
 * pages. The decoded content is the same; the compressed bytes can differ between runtimes. A
 * string is taken byte per UTF-16 unit, as pdf-lib takes it.
 */
export function flateStream(
  context: PDFContext,
  contents: string | Uint8Array,
  dict: StreamDict = {}
): PDFRawStream {
  const bytes = typeof contents === 'string' ? Buffer.from(contents, 'latin1') : contents;
  const deflated = deflateSync(bytes);
  // A small result is a view of zlib's 16 KiB output chunk. pdf-lib keeps every stream until
  // the save, so keep only the bytes rather than one chunk per page.
  const owned =
    deflated.buffer.byteLength > deflated.byteLength * 2 ? new Uint8Array(deflated) : deflated;
  return context.stream(owned, { ...dict, Filter: 'FlateDecode' });
}
type StreamDict = NonNullable<Parameters<PDFContext['stream']>[1]>;
const pageHeights = new WeakMap<PDFPage, number>();
/**
 * A page's height in user space. pdf-lib walks the page tree and parses the media box on
 * every `getHeight()`, and paint asks once per span. The exporter never resizes a page.
 */
export function pageHeight(page: PDFPage): number {
  let height = pageHeights.get(page);
  if (height === undefined) pageHeights.set(page, (height = page.getHeight()));
  return height;
}
const HEX_BYTES = Array.from({ length: 256 }, (_, byte) => byte.toString(16).padStart(2, '0'));
export function hex(value: number): string {
  // A UTF-16 code unit or a character code: always four digits, no wider.
  if (value >= 0 && value <= 0xffff && Number.isInteger(value))
    return HEX_BYTES[value >> 8]! + HEX_BYTES[value & 0xff]!;
  return value.toString(16).padStart(4, '0');
}
export function unicodeHex(text: string): string {
  const out: string[] = [];
  for (let i = 0; i < text.length; i++) out.push(hex(text.charCodeAt(i)));
  return out.join('');
}
export function color(value: string | null | undefined): string {
  const v = value && /^[a-f\d]{6}$/i.test(value) ? value : '000000';
  return [0, 2, 4].map((i) => number(parseInt(v.slice(i, i + 2), 16) / 255)).join(' ');
}
export class Work {
  readonly diagnostics: PdfDiagnostic[] = [];
  private readonly seen = new Set<string>();
  private operations = 0;
  private contentBytes = 0;
  constructor(
    readonly signal: AbortSignal,
    readonly deadline = Infinity
  ) {}
  check(): void {
    if (Date.now() >= this.deadline)
      throw new ExportResourceError('timedOut', 'PDF conversion timed out');
    if (this.signal.aborted)
      throw this.signal.reason instanceof ExportResourceError
        ? this.signal.reason
        : new ExportResourceError('aborted', 'PDF conversion aborted', {
            cause: this.signal.reason,
          });
  }
  reserveContent(bytes: number): void {
    this.contentBytes += bytes;
    if (this.contentBytes > MAX_OUTPUT_BYTES) throw new PdfWorkLimitError();
  }
  tick(): void {
    this.check();
    if (++this.operations > MAX_OPERATIONS) throw new PdfWorkLimitError();
  }
  async yield(): Promise<void> {
    this.check();
    await new Promise<void>((resolve) => setImmediate(resolve));
    this.check();
  }
  report(
    code: string,
    message: string,
    pageIndex?: number,
    severity: PdfDiagnostic['severity'] = 'unsupported',
    origin?: Pick<PdfDiagnostic, 'originIndex' | 'originName'>
  ): void {
    const key = `${code}:${pageIndex ?? ''}:${origin?.originIndex ?? ''}:${message}`;
    if (this.seen.has(key)) return;
    if (this.diagnostics.length >= 10_000) throw new PdfWorkLimitError();
    this.seen.add(key);
    this.diagnostics.push(
      Object.freeze({
        code,
        message,
        pageIndex,
        ...(pageIndex === undefined ? {} : { pageNumber: pageIndex + 1 }),
        severity,
        ...origin,
      })
    );
  }
}
/** Content exceeds a processing budget. @public */
export class PdfWorkLimitError extends Error {
  readonly code = 'workLimitExceeded';
  constructor() {
    super('PDF content, operation, or diagnostic limit exceeded');
    this.name = 'PdfWorkLimitError';
  }
}

/** Bound intermediate content before joining strings or allocating PDF streams. */
export class Commands extends Array<string> {
  constructor(private readonly work: Work) {
    super();
  }
  override push(...values: string[]): number {
    for (const value of values) this.work.reserveContent(value.length + 1);
    return super.push(...values);
  }
  override unshift(...values: string[]): number {
    for (const value of values) this.work.reserveContent(value.length + 1);
    return super.unshift(...values);
  }
}

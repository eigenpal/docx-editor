/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { ExportResourceError } from '@docx-editor.dev/core/export';
import type { PdfDiagnostic } from './types.ts';
import type { LayoutBox } from '@docx-editor.dev/core/layout';

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
export function rect(box: LayoutBox, x: number, y: number, height: number): string {
  return `${number(box.x + x)} ${number(height - box.y - y - box.height)} ${number(box.width)} ${number(box.height)} re`;
}
export function hex(value: number): string {
  return value.toString(16).padStart(4, '0');
}
export function unicodeHex(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) out += hex(text.charCodeAt(i));
  return out;
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
    if (this.contentBytes > MAX_OUTPUT_BYTES)
      throw new RangeError('PDF uncompressed content limit exceeded');
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
    severity: PdfDiagnostic['severity'] = 'unsupported'
  ): void {
    const key = `${code}:${pageIndex ?? ''}:${message}`;
    if (this.seen.has(key)) return;
    if (this.diagnostics.length >= 10_000) throw new PdfWorkLimitError();
    this.seen.add(key);
    this.diagnostics.push(Object.freeze({ code, message, pageIndex, severity }));
  }
}
class PdfWorkLimitError extends Error {
  constructor() {
    super('PDF operation or diagnostic limit exceeded');
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

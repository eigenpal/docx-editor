/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { MAX_OUTPUT_BYTES, positiveLimit } from './context.ts';
import type { PdfExportOptions } from './types.ts';

/** Validate caller options before reading a document or calling a font resolver. */
export function validateOptions(options: PdfExportOptions): {
  timeoutMs: number;
  maxBytes: number;
  maxPages: number;
} {
  if (!options || typeof options !== 'object' || Array.isArray(options))
    throw new TypeError('options must be an object');
  for (const [name, choices] of [
    ['fidelityPolicy', ['strict', 'best-effort']],
    ['fontPolicy', ['strict', 'best-effort']],
    ['displayMode', ['proposed', 'original', 'all-markup']],
  ] as const) {
    const value = options[name];
    if (value !== undefined && !(choices as readonly unknown[]).includes(value))
      throw new RangeError(`Invalid ${name}: expected ${choices.join(', ')}`);
  }
  for (const name of ['useSystemFonts', 'comments', 'documentLigatures'] as const) {
    if (options[name] !== undefined && typeof options[name] !== 'boolean')
      throw new TypeError(`${name} must be boolean`);
  }
  for (const name of ['resourceTimeoutMs', 'fontResolutionTimeoutMs'] as const) {
    const value = options[name];
    if (value !== undefined && (!Number.isFinite(value) || value <= 0 || value > 2_147_483_647))
      throw new RangeError(`${name} must be positive and at most 2147483647`);
  }
  for (const name of ['onFontResolution', 'convertPreservedImage'] as const) {
    if (options[name] !== undefined && typeof options[name] !== 'function')
      throw new TypeError(`${name} must be a function`);
  }
  if (
    options.imageDecodePort !== undefined &&
    (!options.imageDecodePort ||
      typeof options.imageDecodePort !== 'object' ||
      typeof options.imageDecodePort.decode !== 'function')
  )
    throw new TypeError('imageDecodePort must provide a decode function');
  const signal = options.signal;
  if (
    signal !== undefined &&
    (!signal ||
      typeof signal.aborted !== 'boolean' ||
      typeof signal.addEventListener !== 'function' ||
      typeof signal.removeEventListener !== 'function')
  )
    throw new TypeError('signal must be an AbortSignal');
  for (const name of ['measurer', 'producer', 'reuseAcrossRevisions'] as const) {
    if ((options as Record<string, unknown>)[name] !== undefined)
      throw new TypeError(`${name} is not supported by exportPdf`);
  }
  const { timeoutMs = 60_000, maxOutputBytes = MAX_OUTPUT_BYTES, maxPages = 10_000 } = options;
  return {
    timeoutMs: positiveLimit(timeoutMs, 2_147_483_647, 'timeoutMs'),
    maxBytes: positiveLimit(maxOutputBytes, MAX_OUTPUT_BYTES, 'maxOutputBytes'),
    maxPages: positiveLimit(maxPages, 10_000, 'maxPages'),
  };
}

/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { ExportResourceError } from '@docx-editor.dev/core/export';
import { Work, PdfWorkLimitError } from './context.ts';
import { validateOptions } from './options.ts';
import {
  PdfDocumentOpenError,
  PdfEncodingError,
  PdfFidelityError,
  type PdfProjectionOptions,
} from './types.ts';

export async function withPdfWork<T>(
  options: PdfProjectionOptions,
  run: (work: Work, phase: () => number) => Promise<T>
): Promise<T> {
  const { timeoutMs } = validateOptions(options);
  const controller = new AbortController();
  const signal = options.signal;
  const abort = (): void =>
    controller.abort(
      new ExportResourceError('aborted', 'PDF conversion aborted', { cause: signal?.reason })
    );
  if (signal?.aborted) abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(
    () => controller.abort(new ExportResourceError('timedOut', 'PDF conversion timed out')),
    timeoutMs
  );
  const work = new Work(controller.signal, Date.now() + timeoutMs);
  const started = performance.now();
  try {
    work.check();
    return await run(work, () => Math.round(performance.now() - started));
  } catch (error) {
    // Recover deadline codes and caller causes when Core reports a resource abort.
    if (
      (error instanceof PdfDocumentOpenError && error.reason === 'aborted') ||
      (error instanceof ExportResourceError && error.code === 'aborted')
    )
      work.check();
    if (
      error instanceof PdfFidelityError ||
      error instanceof PdfDocumentOpenError ||
      error instanceof ExportResourceError ||
      error instanceof RangeError ||
      error instanceof PdfEncodingError ||
      error instanceof PdfWorkLimitError
    )
      throw error;
    work.check();
    throw new PdfEncodingError('PDF encoding failed', { cause: error });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

/** Stop waiting without disposing a caller-owned session or losing a later rejection. */
export function waitForPdfWork<T>(run: () => Promise<T>, work: Work): Promise<T> {
  work.check();
  return new Promise<T>((resolve, reject) => {
    const abort = (): void => {
      try {
        work.check();
      } catch (error) {
        reject(error);
      }
    };
    work.signal.addEventListener('abort', abort, { once: true });
    const clear = (): void => work.signal.removeEventListener('abort', abort);
    Promise.resolve()
      .then(() => {
        work.check();
        return run();
      })
      .then(
        (value) => {
          clear();
          resolve(value);
        },
        (error) => {
          clear();
          reject(error);
        }
      );
  });
}

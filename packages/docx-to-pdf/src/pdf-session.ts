/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { openExportSession } from './open-session.ts';
import { validateOptions } from './options.ts';
import type { OpenPdfDocumentForExportOptions, OpenPdfDocumentForExportResult } from './types.ts';

/**
 * Open a reusable PDF session over immutable DOCX bytes.
 * Pass the session to exportPdfFrom or Markdown's exportMarkdownFrom.
 * The caller must dispose the session. Its signal controls the entire session lifetime.
 * @public
 */
export async function openDocumentForExport(
  source: Uint8Array,
  options: OpenPdfDocumentForExportOptions = {}
): Promise<OpenPdfDocumentForExportResult> {
  if (!(source instanceof Uint8Array)) throw new TypeError('source must be a Uint8Array');
  validateOptions(options);
  for (const key of ['comments', 'fidelityPolicy', 'timeoutMs', 'maxOutputBytes', 'maxPages']) {
    if ((options as Record<string, unknown>)[key] !== undefined)
      throw new TypeError(`${key} must be configured in exportPdfFrom`);
  }
  return openExportSession(source, options, options.signal);
}

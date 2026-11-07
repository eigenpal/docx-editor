/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import type { CompareDocumentsEngine } from '@docx-editor.dev/core/editor';
import { readOoxmlPackage } from '@docx-editor.dev/core/store';
import { comparePackages } from './compare-documents.ts';

export { compareDocuments } from './compare-documents.ts';
export type {
  CompareDocumentsErrorCode,
  CompareDocumentsRefusalReason,
  CompareDocumentsOptions,
  CompareDocumentsResult,
} from './compare-types.ts';

/** The compare engine the review module contributes to editors and automation hosts. */
export const compareDocumentsEngine: CompareDocumentsEngine = (original, revised, options) => {
  const read = readOoxmlPackage(revised);
  if (!read.ok) {
    return {
      ok: false,
      code: 'invalidRevised',
      message: `The revised document cannot be read (${read.reason}).`,
    };
  }
  const result = comparePackages(original, read.package, options);
  return result.ok
    ? {
        ok: true,
        package: result.package,
        revisionCount: result.revisionCount,
        changed: result.changed,
      }
    : result;
};

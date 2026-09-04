/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { formatRevisionOf, type RevisionAttribution } from '@docx-editor.dev/core/layout';
import type { PdfFidelityDiagnostic } from './pdf-fidelity-diagnostics.ts';
import {
  pdfApproximationDiagnostic,
  pdfUnsupportedDiagnostic,
} from './pdf-fidelity-diagnostics.ts';
import type { PdfTextDecoration, PdfTextStyle } from './pdf-text-style.ts';

/** Word kind colours from Core `--doc-revision-insertion` / `--doc-revision-deletion`. */
export const PDF_REVISION_INSERTION_COLOR = '#2E7D32';
export const PDF_REVISION_DELETION_COLOR = '#C62828';

/**
 * Core `revisionPresentationOf` mapped onto PDF paint commands.
 *
 * Insertion and deletion stay distinguishable: underline vs strike, and green vs red.
 * Dashed insert underlines and double move underlines are not PDF text decorations.
 */
export interface PdfRevisionPresentation {
  readonly color: string;
  readonly decoration: PdfTextDecoration;
  readonly deleted: boolean;
  readonly kind: RevisionAttribution['kind'];
  readonly encodedExactly: boolean;
}

function isDeletionKind(kind: RevisionAttribution['kind']): boolean {
  return kind === 'delete' || kind === 'moveFrom';
}

function isInsertionKind(kind: RevisionAttribution['kind']): boolean {
  return kind === 'insert' || kind === 'moveTo';
}

/**
 * Applies Core insert/delete presentation when PDF commands can encode it.
 * Returns null for untracked text.
 */
export function pdfRevisionPresentationOf(
  revisions: readonly RevisionAttribution[] | undefined
): PdfRevisionPresentation | null {
  if (revisions === undefined || revisions.length === 0) return null;
  const attribution = revisions[revisions.length - 1]!;
  const deleted = revisions.some((revision) => isDeletionKind(revision.kind));
  const kind = attribution.kind;
  if (kind === 'format') return null;
  const line = isDeletionKind(kind) ? 'line-through' : isInsertionKind(kind) ? 'underline' : null;
  const resolvedLine = deleted && line === 'underline' ? 'line-through' : line;
  if (resolvedLine === null) return null;
  const doubleMove = kind === 'moveFrom' || kind === 'moveTo';
  const dashedInsert = kind === 'insert';
  let decoration: PdfTextDecoration;
  if (resolvedLine === 'line-through') {
    decoration = doubleMove ? 'double-strike' : 'strike';
  } else {
    decoration = 'underline';
  }
  return {
    color: deleted ? PDF_REVISION_DELETION_COLOR : PDF_REVISION_INSERTION_COLOR,
    decoration,
    deleted,
    kind,
    encodedExactly: !dashedInsert && !(doubleMove && resolvedLine === 'underline'),
  };
}

/** Overlay Core revision colour and decoration onto a resolved PDF text style. */
export function applyPdfRevisionPresentation(
  style: PdfTextStyle,
  presentation: PdfRevisionPresentation
): PdfTextStyle {
  return Object.freeze({
    ...style,
    color: presentation.color,
    decoration: presentation.decoration,
  });
}

/** Diagnostics for revision cues that PDF text commands cannot encode exactly. */
export function pdfRevisionPresentationDiagnostics(input: {
  readonly pageIndex: number;
  readonly paragraphId: string;
  readonly revisions: readonly RevisionAttribution[] | undefined;
  readonly props: readonly { readonly localName: string }[];
  readonly presentation: PdfRevisionPresentation | null;
}): readonly PdfFidelityDiagnostic[] {
  const diagnostics: PdfFidelityDiagnostic[] = [];
  const format = formatRevisionOf(input.props);
  if (input.presentation === null && format) {
    diagnostics.push(
      pdfUnsupportedDiagnostic({
        feature: 'revision-format',
        pageIndex: input.pageIndex,
        recordKind: 'styleSpan',
        recordId: input.paragraphId,
        reason:
          'Tracked format changes are not encoded as PDF markup; the text paints without a format cue',
      })
    );
  }
  if (input.presentation === null && (input.revisions?.length ?? 0) > 0 && !format) {
    diagnostics.push(
      pdfUnsupportedDiagnostic({
        feature: 'revision-markup',
        pageIndex: input.pageIndex,
        recordKind: 'styleSpan',
        recordId: input.paragraphId,
        reason:
          'Tracked text has no PDF insert or delete decoration, so proposed and deleted text would paint identically',
      })
    );
  }
  if (input.presentation && !input.presentation.encodedExactly) {
    const reason =
      input.presentation.kind === 'insert'
        ? 'Insertion markup uses a dashed underline in Word; PDF encodes a solid underline'
        : 'Move destination markup uses a double underline; PDF encodes a single underline';
    diagnostics.push(
      pdfApproximationDiagnostic({
        feature: 'revision-underline-style',
        pageIndex: input.pageIndex,
        recordKind: 'styleSpan',
        recordId: input.paragraphId,
        reason,
      })
    );
  }
  return diagnostics;
}

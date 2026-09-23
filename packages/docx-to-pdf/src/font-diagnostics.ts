/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import type { ExportFontResolutionReport } from '@docx-editor.dev/core/export';
import type { Work } from './context.ts';
import { isGenericSubstitution } from './font-provisioning.ts';
/** Report font-source recovery and substitutions that can change pagination. */
export function reportFontDiagnostics(resolution: ExportFontResolutionReport, work: Work): void {
  for (const failure of resolution.originFailures) {
    let detail = 'unknown error';
    try {
      if (failure.cause instanceof Error && typeof failure.cause.message === 'string')
        detail = failure.cause.message.slice(0, 1024);
    } catch {
      /* A diagnostic must not fail when a resolver throws an unsafe value. */
    }
    work.report('font-origin-failed', `A font source failed: ${detail}`, undefined, 'information', {
      originIndex: failure.originIndex,
      ...(failure.originName === undefined ? {} : { originName: failure.originName }),
    });
  }
  for (const family of resolution.families) {
    if (
      family.coverage !== 'complete' ||
      family.faces.some(
        (face) =>
          face.via === 'substitution' &&
          face.sourceFamily.toLowerCase() === family.family.toLowerCase()
      )
    )
      work.report(
        'incomplete-font',
        family.coverage !== 'complete'
          ? `Font face coverage is incomplete for ${family.family}; inspect fontResolution`
          : `Font variants use substitute faces from ${family.family}; inspect fontResolution`,
        undefined,
        'information'
      );
    const stand = family.faces.find(
      (face) =>
        face.via === 'substitution' && isGenericSubstitution(family.family, face.sourceFamily)
    );
    if (stand)
      // Not information: the stand-in's metrics move line breaks and page count, so a strict
      // export refuses rather than paginate in another font. Best effort renders and says so.
      work.report(
        'font-substitution',
        `${family.family} is not available; best-effort export renders it in ${stand.sourceFamily}`
      );
  }
}

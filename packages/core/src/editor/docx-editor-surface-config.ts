// The `DocxEditorConfig` fields the surface takes as they are, and the editor's field scope, kept
// out of the composition root so `docx-editor.ts` stays under the max-lines gate.

import type { DocxEditorConfig } from './docx-editor-types.ts';
import type { PaginatedSurfaceOptions } from './paginated-surface-options.ts';
import { copyValidFieldDate } from '../layout/field-date.ts';
import { surfaceFieldResultsScope, type SurfaceFieldResultsScope } from './field-results-scope.ts';

/** The pass-through surface options of `config`, each present only when the host set it. */
export function configSurfaceOptions(
  config: DocxEditorConfig
): Pick<
  PaginatedSurfaceOptions,
  'tableInteractionLabel' | 'imageDecodePort' | 'lockedControlNavigation' | 'fieldDate'
> {
  return {
    ...(config.tableInteractionLabel
      ? { tableInteractionLabel: config.tableInteractionLabel }
      : {}),
    ...(config.imageDecodePort ? { imageDecodePort: config.imageDecodePort } : {}),
    ...(config.lockedControlNavigation === 'atomic' ? { lockedControlNavigation: 'atomic' } : {}),
    ...(config.fieldDate ? { fieldDate: copyValidFieldDate(config.fieldDate)! } : {}),
  };
}

/**
 * The editor's field scope: its field-result mode and its validated copy of `fieldDate`. Refused,
 * not approximated: `editable` with a collaboration session throws, because a shared session
 * keeps every field one unit.
 */
export function editorFieldScope(
  config: DocxEditorConfig,
  collaborationModel: unknown
): SurfaceFieldResultsScope {
  return surfaceFieldResultsScope({
    fieldResults: config.fieldResults,
    collaborationModel,
    fieldDate: config.fieldDate,
  });
}

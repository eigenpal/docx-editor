/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/

import type { TranslationKey } from '@docx-editor.dev/i18n';
import type { ReviewRevisionKind } from '@docx-editor.dev/core/contracts/editor';

/** The packaged sentence for a revision kind that carries no quoted characters of its own. */
export function revisionLabelKey(kind: ReviewRevisionKind): TranslationKey {
  switch (kind) {
    case 'insert':
      return 'review.inserted';
    case 'delete':
      return 'review.deleted';
    case 'replace':
      return 'review.replaced';
    case 'moveFrom':
      return 'review.movedFrom';
    case 'moveTo':
      return 'review.movedTo';
    case 'format':
      return 'revisions.runPropertiesChanged';
    case 'paragraphMark':
      return 'revisions.paragraphMarkInserted';
    default:
      return 'review.structural';
  }
}

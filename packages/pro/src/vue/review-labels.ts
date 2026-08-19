/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/

import type { TranslationKey } from '@docx-editor.dev/i18n';
import type {
  ReviewRevisionItem,
  ReviewRevisionKind,
} from '@docx-editor.dev/core/contracts/editor';

/**
 * The packaged sentence for a revision kind that carries no quoted characters of its own.
 *
 * A paragraph MARK needs its direction as well as its kind. The four members of
 * `EG_ParaRPrTrackChanges` say opposite things about one break — `w:ins` proposes it, `w:del`
 * proposes removing it — and one sentence for all four told a reviewer the reverse of what
 * Accept on that card would do.
 */
export function revisionLabelKey(
  kind: ReviewRevisionKind,
  markDirection?: ReviewRevisionItem['markDirection']
): TranslationKey {
  if (kind === 'paragraphMark') {
    if (markDirection === 'delete') return 'revisions.paragraphMarkDeleted';
    // The two halves of a move are opposite decisions, as they are for content: accepting a
    // `moveFrom` takes this copy of the break away, accepting a `moveTo` keeps it.
    if (markDirection === 'moveFrom') return 'revisions.paragraphMarkMovedFrom';
    if (markDirection === 'moveTo') return 'revisions.paragraphMarkMovedTo';
    return 'revisions.paragraphMarkInserted';
  }
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
    default:
      return 'review.structural';
  }
}

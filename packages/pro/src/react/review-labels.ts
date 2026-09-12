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
  markDirection?: ReviewRevisionItem['markDirection'],
  siteCount = 1
): TranslationKey {
  if (kind === 'paragraphMark') {
    const grouped = siteCount > 1;
    if (markDirection === 'delete') {
      return grouped ? 'revisions.paragraphMarksDeleted' : 'revisions.paragraphMarkDeleted';
    }
    // The two halves of a move are opposite decisions, as they are for content: accepting a
    // `moveFrom` takes this copy of the break away, accepting a `moveTo` keeps it.
    if (markDirection === 'moveFrom') {
      return grouped ? 'revisions.paragraphMarksMovedFrom' : 'revisions.paragraphMarkMovedFrom';
    }
    if (markDirection === 'moveTo') {
      return grouped ? 'revisions.paragraphMarksMovedTo' : 'revisions.paragraphMarkMovedTo';
    }
    return grouped ? 'revisions.paragraphMarksInserted' : 'revisions.paragraphMarkInserted';
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

/** The packaged label for one complete revision item. */
export function revisionItemLabelKey(item: ReviewRevisionItem): TranslationKey {
  return revisionLabelKey(item.revisionKind, item.markDirection, item.ranges.length);
}

/** A grouped paragraph-mark count, including its compact card punctuation. */
export function revisionItemCountSuffix(item: ReviewRevisionItem): string {
  return item.revisionKind === 'paragraphMark' && item.ranges.length > 1
    ? ` (${item.ranges.length})`
    : '';
}

/** The complete packaged card label, including a grouped paragraph-mark count. */
export function revisionItemLabel(
  item: ReviewRevisionItem,
  translate: (key: TranslationKey) => string
): string {
  const label = `${translate(revisionItemLabelKey(item))}${revisionItemCountSuffix(item)}`;
  if (item.revisionKind !== 'format') return label;
  const languages = (item.formattingLanguages ?? []).map((code) => {
    try {
      return (
        new Intl.DisplayNames([translate('_lang')], { type: 'language' }).of(
          new Intl.Locale(code).minimize().toString()
        ) ?? code
      );
    } catch {
      return code;
    }
  });
  const details = [
    ...languages,
    ...(item.formattingChanges ?? []).map((change) => formattingChangeLabel(change, translate)),
  ];
  return details.length ? `${label}: ${details.join(', ')}` : label;
}

function formattingChangeLabel(
  change: NonNullable<ReviewRevisionItem['formattingChanges']>[number],
  translate: (key: TranslationKey) => string
): string {
  const { property, value } = change;
  if (value !== null && (property === 'bold' || property === 'italic' || property === 'strike')) {
    const negative = { bold: 'notBold', italic: 'notItalic', strike: 'notStrike' } as const;
    return translate(
      `revisions.formattingDetails.${value === 'true' ? property : negative[property]}`
    );
  }
  let detail = value ?? translate(`revisions.formattingDetails.default`);
  if (value !== null) {
    if (
      [
        'fontSize',
        'leftIndent',
        'rightIndent',
        'firstLineIndent',
        'hangingIndent',
        'spaceBefore',
        'spaceAfter',
      ].includes(property)
    ) {
      detail = `${value} ${translate(`revisions.formattingDetails.points`)}`;
    } else if (/^(left|center|right|both|start|end|none|single|double|auto)$/.test(value)) {
      detail = translate(`revisions.formattingDetails.${value}` as TranslationKey);
    } else if (property === 'color' && /^[0-9a-f]{6}$/i.test(value)) {
      detail = `#${value.toUpperCase()}`;
    }
  }
  return `${translate(`revisions.formattingDetails.${property}`)}: ${detail}`;
}

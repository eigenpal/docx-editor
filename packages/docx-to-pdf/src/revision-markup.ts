/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import type { ResolvedRevisionMarkup, RevisionMarkupColor } from '@docx-editor.dev/core/editor';
import {
  formatRevisionOf,
  type BlockFragmentRecord,
  type SemanticSpanVisit,
} from '@docx-editor.dev/core/layout';

// These are the print values of the named document revision tokens.
const COLORS: Record<string, string> = {
  black: '000000',
  blue: '0000FF',
  turquoise: '00FFFF',
  green: '008000',
  pink: 'FFC0CB',
  red: 'FF0000',
  yellow: 'FFFF00',
  white: 'FFFFFF',
  darkBlue: '000080',
  teal: '008080',
  darkGreen: '006400',
  violet: '800080',
  darkRed: '800000',
  darkYellow: '808000',
  gray50: '808080',
  gray25: 'C0C0C0',
  lightBlue: 'E0F3FA',
  lightYellow: 'FFF8DC',
  lightOrange: 'FFE5CC',
  lightPurple: 'EADCF4',
  lightGreen: 'E2EFD9',
  gray: 'D9D9D9',
};
const AUTHORS = ['C0392B', '1F6FB2', '7D3C98', '117A65', '9A6206', 'C2185B', '2E4053', '2E7D32'];
export function markupColor(color: RevisionMarkupColor, authorSlot = 0, auto = '000000'): string {
  return color === 'auto'
    ? auto
    : color === 'byAuthor'
      ? AUTHORS[authorSlot % AUTHORS.length]!
      : COLORS[color]!;
}
/** Opaque light author wash, equivalent to the screen's 15% sRGB color mix. */
export function markupBackground(
  color: Exclude<ResolvedRevisionMarkup['insertions']['background'], 'none'>,
  authorSlot = 0
): string {
  const foreground = markupColor(color, authorSlot);
  if (color !== 'byAuthor') return foreground;
  return [0, 2, 4]
    .map((offset) =>
      Math.round(parseInt(foreground.slice(offset, offset + 2), 16) * 0.15 + 255 * 0.85)
        .toString(16)
        .padStart(2, '0')
    )
    .join('');
}
/** A tracked `w:trPr/w:ins|w:del` that every run in the row inherits. */
export interface RowRevision {
  readonly kind: 'insert' | 'delete';
  readonly author: string;
}

/**
 * Index each paragraph fragment inside a tracked table row by that row's revision.
 *
 * A row's runs carry no revision of their own, so a span alone cannot tell it sits in a
 * deleted or inserted row. A deleted outer row wins over any row nested inside it, because
 * accepting that deletion removes the nested table too; otherwise the innermost tracked
 * row applies.
 */
export function indexRowRevisions(
  blocks: readonly BlockFragmentRecord[],
  into: Map<BlockFragmentRecord, RowRevision>,
  tick: () => void,
  inherited?: RowRevision
): void {
  for (const block of blocks) {
    tick();
    if (block.kind === 'paragraph') {
      if (inherited) into.set(block, inherited);
      continue;
    }
    for (const row of block.rows) {
      const own: RowRevision | undefined = row.revisionKind
        ? { kind: row.revisionKind, author: row.revisionAuthor ?? '' }
        : undefined;
      const effective = inherited?.kind === 'delete' ? inherited : (own ?? inherited);
      for (const cell of row.cells) indexRowRevisions(cell.blocks, into, tick, effective);
    }
  }
}

/** The span's revisions with its row's revision, if any, as the outermost one. */
export function spanRevisions(
  visit: SemanticSpanVisit,
  row: RowRevision | undefined
): readonly { readonly kind: string; readonly author: string }[] {
  const own = visit.span.revisions ?? [];
  return row ? [row, ...own] : own;
}

export function spanMarkup(
  visit: SemanticSpanVisit,
  settings: ResolvedRevisionMarkup,
  row?: RowRevision
) {
  const revisions = spanRevisions(visit, row);
  const revision =
    revisions.at(-1) ??
    formatRevisionOf(visit.span.props) ??
    formatRevisionOf(visit.paragraph.props);
  if (!revision) return null;
  // A removed ancestor, including a deleted row, keeps nested insertions visibly removed, in
  // the color of the author who removed it.
  const removing = revisions.find((item) => item.kind === 'delete' || item.kind === 'moveFrom');
  const kind = removing?.kind ?? revision.kind;
  const style =
    kind === 'insert'
      ? settings.insertions
      : kind === 'delete'
        ? settings.deletions
        : kind === 'moveFrom'
          ? settings.trackMoves
            ? settings.movedFrom
            : settings.deletions
          : kind === 'moveTo'
            ? settings.trackMoves
              ? settings.movedTo
              : settings.insertions
            : settings.formatting;
  return { ...style, author: (removing ?? revision).author };
}

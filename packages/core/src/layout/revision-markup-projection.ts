import { withRevisionMarkupEmphasis } from './revision-markup-style.ts';
import { revisionMarkupStyle, type ResolvedRevisionMarkup } from '../contracts/revision-markup.ts';
import type { ResolvedRunStyle } from './run-style.ts';
import { appendChangeSite, type MutableChangeSite, type FieldAwarePiece } from './field-pieces.ts';
import {
  formatRevisionOf,
  revisionIncluded,
  type RevisionAuthorFilter,
  type PieceAttribution,
  type RevisionAttribution,
} from './revision-projection.ts';
import { propertiesOfRunContainer } from './field-run-text.ts';
import type { OoxmlNode, OoxmlProperty } from '@docx-editor.dev/core/store';

/** Resolve local presentation before measuring glyphs. */
export function projectRevisionMarkup(
  text: string,
  style: ResolvedRunStyle,
  projected: boolean,
  settings: ResolvedRevisionMarkup | undefined,
  revision: RevisionAttribution | undefined
): { text: string; style: ResolvedRunStyle; projected: boolean; hidden: boolean } {
  const mark = settings && revision ? revisionMarkupStyle(settings, revision.kind).mark : undefined;
  return {
    text: mark === 'caret' ? '^' : mark === 'pound' ? '#' : text,
    style: mark === 'bold' || mark === 'italic' ? withRevisionMarkupEmphasis(style, mark) : style,
    projected: projected || mark === 'caret' || mark === 'pound',
    hidden: mark === 'hidden',
  };
}

/** Paragraph property revisions apply to the text in that paragraph. */
export function markupFormattingRevision(
  props: readonly OoxmlProperty[],
  paragraph: OoxmlNode
): RevisionAttribution | undefined {
  return (
    formatRevisionOf(props) ??
    formatRevisionOf(
      propertiesOfRunContainer(
        'children' in paragraph
          ? paragraph.children.find((node) => node.kind === 'paragraphProperties')
          : undefined
      )
    ) ??
    undefined
  );
}

export function markupRevisionOf(
  piece: PieceAttribution,
  paragraph: OoxmlNode,
  filter: RevisionAuthorFilter | undefined
): RevisionAttribution | undefined {
  const revision =
    piece.revisions?.find((item) => item.kind === 'delete' || item.kind === 'moveFrom') ??
    piece.revisions?.at(-1);
  if (revision) return revision;
  const formatting = markupFormattingRevision(piece.props, paragraph);
  return formatting && (!filter || revisionIncluded(filter, formatting)) ? formatting : undefined;
}

/** Hidden deletion text still marks its line as changed. */
export function recordHiddenMarkup(
  sites: MutableChangeSite[] | undefined,
  start: number,
  end: number,
  piece: PieceAttribution
): void {
  if (sites) appendChangeSite(sites, start, end, piece.revisions ?? []);
}

/** Hidden removals suppress drawing geometry as well as text. */
export function revisionMarkupHidesDrawing(
  revisions: readonly RevisionAttribution[],
  mode: import('./revision-projection.ts').RevisionDisplayMode,
  filter: RevisionAuthorFilter | undefined
): boolean {
  if (mode !== 'all-markup' || !filter?.revisionMarkup) return false;
  const removal = revisions.find(
    (revision) =>
      (revision.kind === 'delete' || revision.kind === 'moveFrom') &&
      revisionIncluded(filter, revision)
  );
  return !!removal && revisionMarkupStyle(filter.revisionMarkup, removal.kind).mark === 'hidden';
}

/** Buffered editable field results use the same measured presentation as ordinary runs. */
export function projectBufferedRevisionMarkup(
  pieces: FieldAwarePiece[],
  paragraph: OoxmlNode,
  mode: import('./revision-projection.ts').RevisionDisplayMode,
  filter: RevisionAuthorFilter | undefined,
  sites: MutableChangeSite[] | undefined
): FieldAwarePiece[] {
  if (mode !== 'all-markup' || !filter?.revisionMarkup) return pieces;
  const result: FieldAwarePiece[] = [];
  for (const piece of pieces) {
    const projected = projectRevisionMarkup(
      piece.text,
      piece.style,
      !!piece.projected,
      filter.revisionMarkup,
      markupRevisionOf(piece, paragraph, filter)
    );
    if (projected.hidden) {
      recordHiddenMarkup(sites, piece.start, piece.end, piece);
      continue;
    }
    result.push(
      projected.text === piece.text && projected.style === piece.style
        ? piece
        : { ...piece, text: projected.text, style: projected.style, projected: projected.projected }
    );
  }
  return result;
}

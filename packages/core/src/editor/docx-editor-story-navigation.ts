// Shared scoped-story navigation for facade search and review activation.

import type { DocumentEditingMode, ExecResult, TextMatch, ViewScope } from '../contracts/editor.ts';
import type { SemanticPosition } from '../layout/semantic-interaction.ts';
import type { PaginatedSurface } from './paginated-surface-contract.ts';

type ScopedStory =
  | {
      readonly kind: 'headerFooter';
      readonly rId: string;
      readonly furnitureKind?: 'header' | 'footer';
    }
  | { readonly kind: 'note'; readonly id: string };

/** Enter one non-body story at a model position. */
export function enterStoryPosition(
  surface: PaginatedSurface,
  scope: ScopedStory,
  position: SemanticPosition
): ExecResult {
  if (scope.kind === 'note') {
    const entered = surface.enterNote?.(scope.id, position);
    return entered
      ? { ok: true, changed: false }
      : { ok: false, code: 'unsupported', reason: 'the note could not be opened' };
  }

  const entered = scope.furnitureKind
    ? surface.enterHeaderFooter?.({
        rId: scope.rId,
        kind: scope.furnitureKind,
        position,
      })
    : surface.enterHeaderFooter?.({ rId: scope.rId, position });
  return entered
    ? { ok: true, changed: false }
    : { ok: false, code: 'unsupported', reason: 'the header or footer could not be opened' };
}

/** Whether a public view scope is one this helper can open. */
export function isScopedStory(scope: ViewScope | undefined): scope is ScopedStory {
  return scope?.kind === 'headerFooter' || scope?.kind === 'note';
}

/** Whether navigation can open every story returned by document search. */
export function searchStoriesForSurface(
  surface: PaginatedSurface,
  editingMode: DocumentEditingMode
): 'all' | 'body' {
  return editingMode !== 'viewing' &&
    typeof surface.enterHeaderFooter === 'function' &&
    typeof surface.enterNote === 'function'
    ? 'all'
    : 'body';
}

/** Leave a scoped story only when the destination is a body paragraph. */
export function leaveScopeForBodyParagraph(surface: PaginatedSurface, paragraphId: string): void {
  if (surface.activeScope().kind === 'body') return;
  if (!surface.session.paragraphIds().includes(paragraphId)) return;
  surface.exitNote?.();
  surface.exitHeaderFooter?.();
}

/** Select and reveal one match in the story that owns it. */
export function selectDocumentSearchMatch(surface: PaginatedSurface, match: TextMatch): ExecResult {
  if (
    typeof match?.blockId !== 'string' ||
    match.blockId.length === 0 ||
    !Number.isInteger(match.start) ||
    match.start < 0 ||
    !Number.isInteger(match.length) ||
    match.length < 0
  ) {
    return { ok: false, code: 'invalidArgs', reason: 'match must carry a blockId and offsets' };
  }
  const position = { paragraphId: match.blockId, offset: match.start };
  if (isScopedStory(match.scope)) {
    const entered = enterStoryPosition(surface, match.scope, position);
    if (!entered.ok) return entered;
  } else if (match.scope && match.scope.kind !== 'body') {
    return { ok: false, code: 'unsupported', reason: 'the match scope cannot be opened' };
  } else {
    leaveScopeForBodyParagraph(surface, match.blockId);
  }
  surface.setSelection({
    anchor: position,
    head: { paragraphId: match.blockId, offset: match.start + match.length },
  });
  surface.revealParagraph(match.blockId);
  return { ok: true, changed: false };
}

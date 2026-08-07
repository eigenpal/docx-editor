import type { DocumentEditingMode, ReviewItemPlacement } from '../contracts/editor.ts';
import type { ExecResult } from '../contracts/types.ts';
import type { ReviewItem } from '../layout/index.ts';
import type { StoryScope } from '../store/store/tree-package-store.ts';
import type { PaginatedSurface } from './paginated-surface-contract.ts';

interface CommentResolutionDeps {
  readonly reviewEnabled: boolean;
  readonly editingMode: DocumentEditingMode;
  readonly placements: () => readonly ReviewItemPlacement[];
  readonly surface: PaginatedSurface | null;
  readonly proReviewReason: string;
  readonly storyScopeOf: (item: ReviewItem) => StoryScope;
  readonly bump: () => void;
}

/**
 * Resolve or reopen the comment behind a public review card.
 *
 * Kept beside the facade rather than in the Pro adapter: this is an engine write with the same
 * package transaction, viewing gate and typed refusals as the rest of the review commands.
 */
export function setReviewCommentResolved(
  deps: CommentResolutionDeps,
  key: string,
  resolved: boolean
): ExecResult {
  if (!deps.reviewEnabled) {
    return { ok: false, code: 'unsupported', reason: deps.proReviewReason };
  }
  if (deps.editingMode === 'viewing') {
    return { ok: false, code: 'locked', reason: 'the document is open for viewing' };
  }
  const placements = deps.placements();
  const placement = placements.find((entry) => entry.key === key);
  const item = placement?.item as ReviewItem | undefined;
  if (!item || !deps.surface) {
    return { ok: false, code: 'notFound', reason: 'no review item with that key' };
  }
  if (item.kind !== 'comment') {
    return { ok: false, code: 'kindMismatch', reason: 'the review item is not a comment' };
  }

  // Resolve the CONVERSATION even if a host hands the hook one of its reply items. Word's done
  // state belongs to the thread; writing it on a reply alone creates a split state no pane can
  // represent.
  let thread = item;
  const commentsById = new Map(
    placements
      .map((entry) => entry.item as ReviewItem)
      .filter((candidate) => candidate.kind === 'comment')
      .map((candidate) => [candidate.id, candidate] as const)
  );
  const seen = new Set<string>();
  while (thread.parentId !== undefined && !seen.has(thread.id)) {
    seen.add(thread.id);
    const parent = commentsById.get(thread.parentId);
    if (!parent || parent.kind !== 'comment') break;
    thread = parent;
  }

  // A repeated action succeeds without dirtying the document or allocating an Undo unit.
  if (thread.resolved === resolved) return { ok: true, changed: false };

  let changed = false;
  deps.surface.commitReviewOps(() => {
    changed = deps.surface!.session.setCommentResolved(
      thread.id,
      resolved,
      deps.storyScopeOf(thread)
    );
    return { committed: changed };
  });
  if (!changed) {
    return { ok: false, code: 'notFound', reason: 'the comment could not be resolved' };
  }
  deps.bump();
  return { ok: true, changed: true };
}

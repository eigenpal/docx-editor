import type { DocumentEditingMode, ReviewItemPlacement } from '../contracts/editor.ts';
import type { ExecResult } from '../contracts/types.ts';
import type { ReviewCommentItem, ReviewItem } from '../layout/index.ts';
import type { PaginatedSurface } from './paginated-surface-contract.ts';

interface CommentResolutionDeps {
  readonly reviewEnabled: boolean;
  readonly editingMode: DocumentEditingMode;
  readonly placements: () => readonly ReviewItemPlacement[];
  readonly surface: PaginatedSurface | null;
  readonly proReviewReason: string;
  readonly bump: () => void;
}

function isCommentItem(item: ReviewItem): item is ReviewCommentItem {
  return item.kind === 'comment';
}

/**
 * Same global `w:comment` record listed more than once (body + header markers, notes) is
 * valid. Two records, or two keys, sharing an id are not — first-match would resolve the
 * wrong thread.
 */
function uniqueCommentById(
  placements: readonly ReviewItemPlacement[]
): Map<string, ReviewCommentItem> | 'ambiguous' {
  const byId = new Map<string, ReviewCommentItem>();
  for (const placement of placements) {
    const item = placement.item as ReviewItem;
    if (!isCommentItem(item)) continue;
    const existing = byId.get(item.id);
    if (existing === undefined) {
      byId.set(item.id, item);
      continue;
    }
    if (existing.comment !== item.comment) return 'ambiguous';
  }
  return byId;
}

function commentForKey(
  placements: readonly ReviewItemPlacement[],
  key: string
): ReviewCommentItem | ExecResult {
  const matches = placements.filter((entry) => entry.key === key);
  if (matches.length === 0) {
    return { ok: false, code: 'notFound', reason: 'no review item with that key' };
  }
  const comments = matches.map((entry) => entry.item as ReviewItem).filter(isCommentItem);
  if (comments.length === 0) {
    return { ok: false, code: 'kindMismatch', reason: 'the review item is not a comment' };
  }
  const first = comments[0]!;
  for (const candidate of comments) {
    if (candidate.comment !== first.comment) {
      return {
        ok: false,
        code: 'ambiguous',
        reason: 'duplicate comment records share that key',
      };
    }
  }
  return first;
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
  const item = commentForKey(placements, key);
  if (!('kind' in item)) return item;
  if (!deps.surface) {
    return { ok: false, code: 'notFound', reason: 'no review item with that key' };
  }

  const commentsById = uniqueCommentById(placements);
  if (commentsById === 'ambiguous') {
    return {
      ok: false,
      code: 'ambiguous',
      reason: 'duplicate comment records share an id',
    };
  }

  // Resolve the CONVERSATION even if a host hands the hook one of its reply items. Word's done
  // state belongs to the thread; writing it on a reply alone creates a split state no pane can
  // represent.
  let thread = item;
  const seen = new Set<string>();
  while (thread.parentId !== undefined && !seen.has(thread.id)) {
    seen.add(thread.id);
    const parent = commentsById.get(thread.parentId);
    if (!parent) break;
    thread = parent;
  }

  // Always index the full thread. A resolved root with an unresolved descendant must repair;
  // truncation or malformed metadata must refuse even when the root already matches.
  let ok = false;
  let changed = false;
  deps.surface.commitReviewOps(() => {
    const revision = deps.surface!.session.packageRevision();
    ok = deps.surface!.session.setCommentResolved(thread.id, resolved);
    changed = ok && deps.surface!.session.packageRevision() !== revision;
    return { committed: changed };
  }, 'comment-resolve');
  if (!ok) {
    return { ok: false, code: 'notFound', reason: 'the comment could not be resolved' };
  }
  if (changed) deps.bump();
  return { ok: true, changed };
}

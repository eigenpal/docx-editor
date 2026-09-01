import type {
  MarkdownComment,
  MarkdownPage,
  MarkdownReviewBinding,
  MarkdownReviewUnmappedReason,
} from '@docx-editor.dev/docx-to-markdown';

export interface ReviewSelectionPresentation {
  readonly markdown: string;
  readonly label: 'Selected text' | 'Partial Markdown selection' | 'Containing Markdown construct';
  readonly unmappedReasons: readonly MarkdownReviewUnmappedReason[];
}

export type PageReviewSelectionIndex = ReadonlyMap<string, ReviewSelectionPresentation>;

export interface CommentThreadReply {
  readonly comment: MarkdownComment;
  readonly depth: number;
}

export interface CommentThread {
  readonly root: MarkdownComment;
  readonly replies: readonly CommentThreadReply[];
}

export function pageReviewSelectionKey(pageNumber: number, artifactId: string): string {
  return `${pageNumber}\0${artifactId}`;
}

/** Index page-local review slices once per immutable result. */
export function indexPageReviewSelections(
  pages: readonly MarkdownPage[],
  bindings: readonly MarkdownReviewBinding[]
): PageReviewSelectionIndex {
  interface MutableSelection {
    selections: string[];
    complete: boolean;
    containing: boolean;
    unmappedReasons: MarkdownReviewUnmappedReason[];
  }
  const mutable = new Map<string, MutableSelection>();
  for (const binding of bindings) {
    if (binding.projection.kind !== 'page') continue;
    const page = pages[binding.projection.pageIndex];
    if (!page || page.number !== binding.projection.pageNumber) continue;
    const key = pageReviewSelectionKey(page.number, binding.artifactId);
    const entry = mutable.get(key) ?? {
      selections: [],
      complete: true,
      containing: false,
      unmappedReasons: [],
    };
    mutable.set(key, entry);
    entry.complete &&= binding.coverage === 'complete';
    if (binding.unmappedReason && !entry.unmappedReasons.includes(binding.unmappedReason)) {
      entry.unmappedReasons.push(binding.unmappedReason);
    }
    const markdown = page[binding.projection.field];
    for (const range of binding.ranges) {
      entry.containing ||= range.precision === 'containing-construct';
      const selection = markdown.slice(range.start, range.end).trim();
      if (selection && !entry.selections.includes(selection)) entry.selections.push(selection);
    }
  }

  const indexed = new Map<string, ReviewSelectionPresentation>();
  for (const [key, entry] of mutable) {
    indexed.set(key, {
      markdown: entry.selections.join('\n\n'),
      label: entry.containing
        ? 'Containing Markdown construct'
        : entry.complete
          ? 'Selected text'
          : 'Partial Markdown selection',
      unmappedReasons: Object.freeze([...entry.unmappedReasons]),
    });
  }
  return indexed;
}

/** Resolve complete document-wide threads from the comments that make one page relevant. */
export function pageCommentThreads(
  pageComments: readonly MarkdownComment[],
  commentById: ReadonlyMap<string, MarkdownComment>
): readonly CommentThread[] {
  const roots: MarkdownComment[] = [];
  const seenRoots = new Set<string>();
  for (const pageComment of pageComments) {
    let root = pageComment;
    const ancestors = new Set([root.id]);
    while (root.parentId) {
      const parent = commentById.get(root.parentId);
      if (!parent || ancestors.has(parent.id)) break;
      ancestors.add(parent.id);
      root = parent;
    }
    if (!seenRoots.has(root.id)) {
      seenRoots.add(root.id);
      roots.push(root);
    }
  }

  return roots.map((root) => {
    const replies: CommentThreadReply[] = [];
    const seen = new Set([root.id]);
    const pending = root.replyIds.map((id) => ({ id, depth: 1 }));
    while (pending.length > 0) {
      const next = pending.shift()!;
      if (seen.has(next.id)) continue;
      seen.add(next.id);
      const reply = commentById.get(next.id);
      if (!reply) continue;
      replies.push({ comment: reply, depth: next.depth });
      pending.unshift(...reply.replyIds.map((id) => ({ id, depth: next.depth + 1 })));
    }
    return { root, replies };
  });
}

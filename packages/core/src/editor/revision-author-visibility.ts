import { revisionAuthorFilter, type RevisionAuthorFilter } from '../layout/revision-projection.ts';

/** Mutable view state shared by the facade and its currently mounted surface. */
export interface RevisionAuthorVisibility {
  readonly hiddenAuthors: ReadonlySet<string>;
  readonly hiddenAuthorList: readonly string[];
  readonly filter: RevisionAuthorFilter | undefined;
  isVisible(author: string): boolean;
  setVisible(author: string, visible: boolean): boolean;
  setAllVisible(authors: Iterable<string>, visible: boolean): boolean;
  showAll(): boolean;
}

interface ReviewAuthorCommands {
  isReviewAuthorVisible(author: string): boolean;
  setReviewAuthorVisible(author: string, visible: boolean): void;
  setAllReviewAuthorsVisible(visible: boolean): void;
  showAllReviewAuthors(): void;
}

interface ReviewAuthorSurface {
  revisionAuthors(): ReadonlyMap<string, number>;
  setRevisionAuthorVisible(author: string, visible: boolean): void;
  setAllRevisionAuthorsVisible(visible: boolean): void;
}

interface ReviewRevisionSurface {
  readonly session: {
    packageRevision(): number;
    revision(): number;
  };
}

/**
 * A monotonic signal that moves exactly when the review queue or its chrome inputs can move.
 * Kept outside the facade composition root so preserving this explanation never competes
 * with that file's hard line cap.
 */
export function createReviewRevisionTicker(input: {
  readonly surface: () => ReviewRevisionSurface | null;
  readonly activeKey: () => string | null;
  readonly paneOpen: () => boolean;
  readonly selectionAnchor: () => number | null;
  readonly authorFilterKey: () => string;
}): () => number {
  let tick = 0;
  let seenSurface: ReviewRevisionSurface | null = null;
  let seenRevision = '';
  let seenActive: string | null = null;
  let seenPaneOpen = true;
  let seenSelectionAnchor: number | null = null;
  let seenAuthorFilter = '';
  return () => {
    const surface = input.surface();
    // Both revisions matter: a furniture edit moves only the package revision. Surface
    // identity covers a fresh load, while the active key and selection cover caret-only UI.
    const revision = `${surface?.session.packageRevision() ?? -1}:${surface?.session.revision() ?? -1}`;
    const active = input.activeKey();
    const paneOpen = input.paneOpen();
    const selectionAnchor = input.selectionAnchor();
    const authorFilter = input.authorFilterKey();
    if (
      surface !== seenSurface ||
      revision !== seenRevision ||
      active !== seenActive ||
      paneOpen !== seenPaneOpen ||
      selectionAnchor !== seenSelectionAnchor ||
      authorFilter !== seenAuthorFilter
    ) {
      seenSurface = surface;
      seenRevision = revision;
      seenActive = active;
      seenPaneOpen = paneOpen;
      seenSelectionAnchor = selectionAnchor;
      seenAuthorFilter = authorFilter;
      tick += 1;
    }
    return tick;
  };
}

export function createRevisionAuthorVisibility(
  initial: Iterable<string> = []
): RevisionAuthorVisibility {
  let hidden = new Set(initial);
  let hiddenList: readonly string[] = Object.freeze([...hidden]);
  let filter = revisionAuthorFilter(hidden);
  return {
    get hiddenAuthors() {
      return hidden;
    },
    get hiddenAuthorList() {
      return hiddenList;
    },
    get filter() {
      return filter;
    },
    isVisible: (author) => !hidden.has(author),
    setVisible(author, visible) {
      if (visible === !hidden.has(author)) return false;
      const next = new Set(hidden);
      if (visible) next.delete(author);
      else next.add(author);
      hidden = next;
      hiddenList = Object.freeze([...next]);
      filter = revisionAuthorFilter(next);
      return true;
    },
    setAllVisible(authors, visible) {
      const next = visible ? new Set<string>() : new Set(authors);
      if (next.size === hidden.size && [...next].every((author) => hidden.has(author)))
        return false;
      hidden = next;
      hiddenList = Object.freeze([...next]);
      filter = revisionAuthorFilter(next);
      return true;
    },
    showAll() {
      if (hidden.size === 0) return false;
      hidden = new Set();
      hiddenList = Object.freeze([]);
      filter = undefined;
      return true;
    },
  };
}

export function filterReviewItemsByAuthor<T>(
  items: readonly T[],
  visibility: RevisionAuthorVisibility,
  authorOf: (item: T) => string | null
): readonly T[] {
  if (visibility.hiddenAuthors.size === 0) return items;
  return items.filter((item) => {
    const author = authorOf(item);
    return author === null || visibility.isVisible(author);
  });
}

export function reviewItemAuthorOrNull(item: {
  readonly kind: string;
  readonly author?: string;
  readonly comment?: { readonly author: string };
}): string | null {
  return item.kind === 'comment' ? (item.comment?.author ?? '') : (item.author ?? null);
}

export function createReviewAuthorCommands(
  visibility: RevisionAuthorVisibility,
  options: {
    readonly enabled: boolean;
    readonly surface: () => ReviewAuthorSurface | null;
    readonly notify: () => void;
  }
): ReviewAuthorCommands {
  const setAll = (visible: boolean): void => {
    if (!options.enabled) return;
    const surface = options.surface();
    if (surface) return surface.setAllRevisionAuthorsVisible(visible);
    // Detached has no reviewer roster. Showing all is knowable; hiding all is not, and an
    // empty roster would invert the command by clearing the authors already hidden.
    if (!visible || !visibility.showAll()) return;
    options.notify();
  };
  return {
    isReviewAuthorVisible: visibility.isVisible,
    setReviewAuthorVisible(author, visible) {
      if (!options.enabled) return;
      const surface = options.surface();
      if (surface) return surface.setRevisionAuthorVisible(author, visible);
      if (!visibility.setVisible(author, visible)) return;
      options.notify();
    },
    setAllReviewAuthorsVisible: setAll,
    showAllReviewAuthors: () => setAll(true),
  };
}

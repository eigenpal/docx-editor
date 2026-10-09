// The review queue's paragraph order over every story, kept across text-only commits.

import type { TreeDocxSessionView } from '../binding/tree-session-contract.ts';
import {
  deepParagraphOrderOfPart,
  type OoxmlPart,
  type TreeModelChange,
} from '@docx-editor.dev/core/store';

/**
 * Paragraph id to document position over EVERY story the review queue lists — body
 * first, then each furniture part — memoized per package revision and body root.
 *
 * Deliberately NOT the open story's scoped order: `rangeCovers` looks the caret's and an
 * item's paragraphs up here, and an id the index cannot see is an item that can never
 * become active. Scoping to the open story made every header item unactivatable from
 * the body, every body item unactivatable while a header was open, and every textbox
 * item unactivatable always (the shallow order stops at the host paragraph) — the DEEP
 * order descends into `w:txbxContent`. Containment only ever compares positions within
 * one story, and furniture ranks after the body, so the merge cannot invent a cover.
 */
export function createReviewOrderIndex(
  session: Pick<
    TreeDocxSessionView,
    'packageRevision' | 'part' | 'partFor' | 'headerFooterPartsBySection'
  >
): {
  /** The index for the session's current revision. */
  index(): Map<string, number>;
  /** Called for every model change; see the note on the body. */
  retain(change: TreeModelChange): void;
} {
  let cache: {
    readonly packageRevision: number;
    readonly bodyRoot: object;
    readonly index: Map<string, number>;
    /** The other stories the index read, in order. */
    readonly otherParts: readonly OoxmlPart[];
  } | null = null;
  /** Every header, footer, and note part, in the order the index appends them. */
  const otherStoryParts = (): OoxmlPart[] => {
    const parts: OoxmlPart[] = [];
    const seen = new Set<OoxmlPart>([session.part()]);
    for (const section of session.headerFooterPartsBySection()) {
      for (const slots of [section.headers, section.footers]) {
        for (const part of slots.values()) {
          if (seen.has(part)) continue;
          seen.add(part);
          parts.push(part);
        }
      }
    }
    for (const noteKind of ['footnote', 'endnote'] as const) {
      const part = session.partFor({ kind: 'notesPart', noteKind });
      if (!part || seen.has(part)) continue;
      seen.add(part);
      parts.push(part);
    }
    return parts;
  };
  const sameParts = (left: readonly OoxmlPart[], right: readonly OoxmlPart[]): boolean =>
    left.length === right.length && left.every((part, index) => part === right[index]);
  return {
    /**
     * Carry the index across a commit that cannot reorder paragraphs.
     *
     * The key is (package revision, body root) and a keystroke moves both, so without this the
     * memo guaranteed exactly one whole-document rebuild per keystroke — the #391 shape, in the
     * render path. A text-local commit with no created, deleted, split or joined paragraphs
     * preserves every paragraph id and their order in every story, so the index is re-stamped
     * to the values the next read will key on. A property or list commit keeps every paragraph
     * too, but a list commit follows a package-shell write of its definition, so it is carried
     * only while every other story part is still the same object. Anything wider drops it, and
     * commits that bypass the subscription (a package-shell edit) leave a stale key the
     * read-side check rebuilds — the safe direction.
     */
    retain(change) {
      if (!cache) return;
      const otherParts = change.impact === 'text-local' ? cache.otherParts : otherStoryParts();
      if (
        change.impact !== 'global' &&
        change.created.length === 0 &&
        change.deleted.length === 0 &&
        change.splitJoin.length === 0 &&
        (change.impact === 'text-local' || sameParts(cache.otherParts, otherParts))
      ) {
        cache = {
          packageRevision: session.packageRevision(),
          bodyRoot: session.part().root,
          index: cache.index,
          otherParts,
        };
      } else {
        cache = null;
      }
    },
    index() {
      const packageRevision = session.packageRevision();
      const bodyRoot = session.part().root;
      if (cache && cache.packageRevision === packageRevision && cache.bodyRoot === bodyRoot) {
        return cache.index;
      }
      const index = new Map<string, number>();
      const append = (order: ReadonlyMap<string, number>): void => {
        const base = index.size;
        for (const [id, position] of order) {
          if (!index.has(id)) index.set(id, base + position);
        }
      };
      append(deepParagraphOrderOfPart(session.part()));
      // Note stories too, now that their revisions reach the queue: a paragraph missing from
      // this index is an item `rangeCovers` can never match, so a footnote card listed but
      // could never become the ACTIVE one — and the rail gates its reply box on that.
      const otherParts = otherStoryParts();
      for (const part of otherParts) append(deepParagraphOrderOfPart(part));
      cache = { packageRevision, bodyRoot, index, otherParts };
      return index;
    },
  };
}

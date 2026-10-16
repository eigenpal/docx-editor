// Paint no markup for revision records the review queue leaves out.
//
// A property change that resolves to the same formatting has no review card, so its paragraph
// gets no change bar and its text no format mark either. The record's node ids leave the view
// the way an excluded change does: projected as proposed, which for these records looks the
// same as the original.

import type { RevisionAttribution, RevisionAuthorFilter } from './revision-projection.ts';
import { EMPTY_REVISION_AUTHOR_SET } from './revision-projection.ts';
import { stableHash } from '../store/comparators/canonical.ts';

const composed = new WeakMap<object, WeakMap<ReadonlySet<string>, RevisionAuthorFilter>>();
const NO_FILTER = {};

/**
 * `base` with the sites in `hidden` excluded. Answers `base` itself when `hidden` is empty, and
 * the same object for the same pair, so layout caches keyed on the filter stay warm.
 */
export function withHiddenRevisionSites(
  base: RevisionAuthorFilter | undefined,
  hidden: ReadonlySet<string>
): RevisionAuthorFilter | undefined {
  if (hidden.size === 0) return base;
  const byHidden = composed.get(base ?? NO_FILTER) ?? new WeakMap();
  composed.set(base ?? NO_FILTER, byHidden);
  const known = byHidden.get(hidden);
  if (known) return known;
  const includesNode = (nodeId: string, author: string) =>
    !hidden.has(nodeId) &&
    (base?.includesNode?.(nodeId, author) ??
      !(base?.hiddenAuthors ?? EMPTY_REVISION_AUTHOR_SET).has(author));
  const filter: RevisionAuthorFilter = Object.freeze({
    ...base,
    hiddenAuthors: base?.hiddenAuthors ?? EMPTY_REVISION_AUTHOR_SET,
    includes: (revision: RevisionAttribution) =>
      !hidden.has(revision.nodeId) &&
      (base?.includes?.(revision) ?? includesNode(revision.nodeId, revision.author)),
    includesNode,
    excludedNodeMode: (nodeId: string, author: string) =>
      hidden.has(nodeId) ? 'proposed' : (base?.excludedNodeMode?.(nodeId, author) ?? 'proposed'),
    cacheKey: `${base?.cacheKey ?? ''}|unlisted:${stableHash([...hidden].sort())}`,
  });
  byHidden.set(hidden, filter);
  return filter;
}

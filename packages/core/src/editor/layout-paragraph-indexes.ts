// Per-layout paragraph indexes the editor facade reads, memoized by layout identity.
// Split out of `docx-editor.ts`, which is at its line cap.

import { documentOrder, paragraphFragmentsOfBlocks, type SemanticLayout } from '../layout/index.ts';
import { fragmentParagraphs } from '../layout/line-segments.ts';

/**
 * Paragraph id → note scope id, built once per LAYOUT from the painted note stories.
 *
 * The layout already states which note each paragraph belongs to (`NoteStoryRecord`
 * carries `scopeId`), so this is a lookup rather than a search. The first version walked
 * the notes part per item — O(items x notes x subtree), which measured 91 ms per
 * `getTrackedChanges()` call on a document with 600 note revisions.
 */
const noteScopeIndexCache = new WeakMap<SemanticLayout, Map<string, string>>();
export function noteScopeIndexOf(layout: SemanticLayout): Map<string, string> {
  const cached = noteScopeIndexCache.get(layout);
  if (cached) return cached;
  const index = new Map<string, string>();
  for (const page of layout.pages) {
    for (const area of [page.footnotes, page.endnotes]) {
      if (!area) continue;
      for (const note of area.notes) {
        for (const fragment of paragraphFragmentsOfBlocks(note.fragments)) {
          // Every paragraph the fragment DRAWS. A note whose paragraphs a resolved view
          // merges publishes one fragment, and an absorbed member with no scope made its
          // card look like a body card: no note to accept it in, no note to scroll to.
          for (const paragraphId of fragmentParagraphs(fragment)) {
            if (!index.has(paragraphId)) index.set(paragraphId, note.scopeId);
          }
        }
      }
    }
  }
  noteScopeIndexCache.set(layout, index);
  return index;
}

/** Paragraph id to document position, memoized per layout. */
const paragraphOrderCache = new WeakMap<SemanticLayout, Map<string, number>>();
export function paragraphOrderOf(layout: SemanticLayout): Map<string, number> {
  const cached = paragraphOrderCache.get(layout);
  if (cached) return cached;
  const index = new Map<string, number>();
  for (const [position, id] of documentOrder(layout).entries()) index.set(id, position);
  paragraphOrderCache.set(layout, index);
  return index;
}

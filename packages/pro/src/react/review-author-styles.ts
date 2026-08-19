/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// How the review chrome draws ONE author.
//
// The engine resolves per-author presentation for the painted document; this is the review
// surface's side of the same answer, so a card and the text it annotates cannot disagree
// about who draws in what. Extracted from `DocxEditorReview.tsx`, which sits at its
// max-lines cap.

import { useMemo, useRef } from 'react';
import type { CSSProperties } from 'react';
import type { DocxEditorInstance, RevisionAuthor } from '@docx-editor.dev/core/editor';
import type { ReviewItemView } from './useReview';

/** How many author slots the token ramp defines; past it, colours repeat. */
export const AUTHOR_SLOTS = 8;

/**
 * The accent this author's chrome keys on: their resolved document colour from the facade
 * roster — the same derivation the painted text colours by — with the rail's own item-order
 * slot standing in for an author the roster does not carry (a comment-only author has no
 * revision in the layout).
 *
 * The accent is the ONLY styling the packaged card takes from a declaration. Card DESIGN
 * belongs to composition — a custom card over `useReviewAuthor`, or CSS on the
 * `data-author`/`data-author-slot` hooks — never to a config record.
 */
export function authorAccent(info: RevisionAuthor | undefined, fallbackSlot: number): string {
  return info?.color ?? `var(--doc-review-author-${fallbackSlot % AUTHOR_SLOTS})`;
}

export function authorCardStyle(
  info: RevisionAuthor | undefined,
  fallbackSlot: number
): CSSProperties {
  return { '--doc-review-author': authorAccent(info, fallbackSlot) } as CSSProperties;
}

/**
 * The slot a surface should draw this author in.
 *
 * The FACADE's slot when the document carries the author, so a card and the painted text
 * agree — they are the same number the painter writes as `data-revision-author-slot`. The
 * rail's own item-order slot stands in only for an author the document has no revision by
 * (a comment-only reviewer), whom the painter never numbers at all.
 */
export function authorSlot(info: RevisionAuthor | undefined, fallbackSlot: number): number {
  return (info?.slot ?? fallbackSlot) % AUTHOR_SLOTS;
}

/**
 * The rail's author lookup: the document's roster, plus an entry for every review item
 * author the roster does not carry.
 *
 * COMMENT-ONLY AUTHORS are the reason for the second half. The roster reads the DOCUMENT,
 * so someone who commented but proposed no tracked change is not in it — and their card
 * would ignore the style declared for them, avatar included.
 *
 * Synthesised entries are held ACROSS recomputes: this memo re-runs whenever the review
 * queue moves, and minting a fresh object each time would hand a consumer using
 * `useReviewAuthor` in a dependency array a new identity on every comment.
 */
export function useReviewAuthorInfo(
  roster: readonly RevisionAuthor[],
  items: readonly ReviewItemView[],
  authorSlots: ReadonlyMap<string, number>,
  editor: DocxEditorInstance | null
): ReadonlyMap<string, RevisionAuthor> {
  const synthetic = useRef(new Map<string, RevisionAuthor>());
  return useMemo(() => {
    const byAuthor = new Map<string, RevisionAuthor>();
    for (const info of roster) byAuthor.set(info.author, info);
    for (const entry of items) {
      if (!entry.author || byAuthor.has(entry.author)) continue;
      const slot = authorSlots.get(entry.author) ?? 0;
      const style = editor?.getRevisionAuthorStyle(entry.author);
      const color = style?.color ?? `var(--doc-review-author-${slot % AUTHOR_SLOTS})`;
      const cached = synthetic.current.get(entry.author);
      const resolved: RevisionAuthor =
        cached !== undefined &&
        cached.slot === slot &&
        cached.color === color &&
        cached.style === style
          ? cached
          : { author: entry.author, slot, color, ...(style ? { style } : {}) };
      synthetic.current.set(entry.author, resolved);
      byAuthor.set(entry.author, resolved);
    }
    return byAuthor;
  }, [roster, items, authorSlots, editor]);
}

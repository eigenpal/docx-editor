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
import type { DocxEditorInstance, ReviewAuthorInfo } from '@docx-editor.dev/core/editor';
import type { ReviewItemView } from './useReview';

/** How many author slots the token ramp defines; past it, colours repeat. */
export const AUTHOR_SLOTS = 8;

/**
 * The accent this author's chrome keys on: their resolved colour from the facade roster —
 * the same derivation the painted text and the highlight bands colour by — with the rail's
 * own item-order slot standing in only for an author the roster has not published yet.
 *
 * The accent is the ONLY styling the packaged card takes from a declaration. Card DESIGN
 * belongs to composition — a custom card over `useReviewAuthor`, or CSS on the
 * `data-author`/`data-author-slot` hooks — never to a config record.
 */
export function authorAccent(info: ReviewAuthorInfo | undefined, fallbackSlot: number): string {
  return info?.color ?? `var(--doc-review-author-${fallbackSlot % AUTHOR_SLOTS})`;
}

export function authorCardStyle(
  info: ReviewAuthorInfo | undefined,
  fallbackSlot: number
): CSSProperties {
  return { '--doc-review-author': authorAccent(info, fallbackSlot) } as CSSProperties;
}

/**
 * The slot a surface should draw this author in.
 *
 * The FACADE's slot whenever the roster carries the author — which is every author of a
 * tracked change OR a comment — so the card, the painted text and the highlight band all
 * agree. That is the same number the painter writes as `data-revision-author-slot`. The
 * rail's own item-order slot stands in only for an author the roster has not published yet.
 */
export function authorSlot(info: ReviewAuthorInfo | undefined, fallbackSlot: number): number {
  return (info?.slot ?? fallbackSlot) % AUTHOR_SLOTS;
}

/**
 * The rail's author lookup: the engine's roster, plus an entry for anyone it does not carry.
 *
 * The roster covers comment authors as well as revision authors, so the second half is a
 * FALLBACK rather than the normal path — it stands in for an author the rail can see and the
 * engine cannot, which is a card the rail is drawing from queue state the surface has not
 * published yet (a comment composed this render). Without it that card would ignore the
 * style declared for its author, avatar included.
 *
 * Synthesised entries are held ACROSS recomputes: this memo re-runs whenever the review
 * queue moves, and minting a fresh object each time would hand a consumer using
 * `useReviewAuthor` in a dependency array a new identity on every comment.
 */
export function useReviewAuthorInfo(
  roster: readonly ReviewAuthorInfo[],
  items: readonly ReviewItemView[],
  authorSlots: ReadonlyMap<string, number>,
  editor: DocxEditorInstance | null
): ReadonlyMap<string, ReviewAuthorInfo> {
  const synthetic = useRef(new Map<string, ReviewAuthorInfo>());
  return useMemo(() => {
    const byAuthor = new Map<string, ReviewAuthorInfo>();
    for (const info of roster) byAuthor.set(info.author, info);
    for (const entry of items) {
      if (!entry.author || byAuthor.has(entry.author)) continue;
      const slot = authorSlots.get(entry.author) ?? 0;
      const style = editor?.getReviewAuthorStyle(entry.author);
      const color = style?.color ?? `var(--doc-review-author-${slot % AUTHOR_SLOTS})`;
      const cached = synthetic.current.get(entry.author);
      const resolved: ReviewAuthorInfo =
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

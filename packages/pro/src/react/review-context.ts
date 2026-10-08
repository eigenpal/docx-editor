/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The rail's private contexts and the two public hooks that read them. The Vue twin is
// `../vue/review-context.ts`.

import { createContext, useCallback, useContext } from 'react';
import type { TranslationKey } from '@docx-editor.dev/i18n';
import type { CommentMarkers, RevisionsIn } from '@docx-editor.dev/core/editor';
import {
  useReviewAuthors,
  useTranslation,
  type ReviewAuthorInfo,
  type ToolbarTranslate,
} from '@docx-editor.dev/react';
import type { useReview, ReviewItemView } from './useReview.ts';

/** The rail's data, provided once by the Root so a card never re-subscribes. */
export const ReviewContext = createContext<ReviewRailValue | null>(null);
/** The card being rendered, so every part inside it reads one item. */
export const ReviewItemContext = createContext<ReviewItemView | null>(null);

/**
 * The review item the surrounding card (or balloon) renders, or null outside one.
 *
 * The hook a host's own card content is built from: children passed into the rail's cards
 * — extra actions, a custom body — read the CURRENT item here rather than receiving props,
 * exactly the way the packaged parts do.
 *
 * @public
 */
export function useReviewItem(): ReviewItemView | null {
  return useContext(ReviewItemContext);
}

/**
 * The resolved presentation of one author — colour, ramp slot, and any declared style —
 * or `undefined` when no argument is given, or when the author is in neither the
 * document's roster nor the review queue.
 *
 * COMMENT AUTHORS INCLUDED. The document's revision roster does not carry someone who only
 * left comments, so this resolves their declaration directly; their card draws in the
 * colour the host declared, exactly as a reviewer's does.
 *
 * The link between a CUSTOM card and the author styling system: a `List` render callback
 * or card child reads the item's author here and draws with the same colours the painted
 * document and the packaged cards use. Live: a `setRevisionStyles` call re-renders the
 * rail, and this answer with it. Outside the rail it reads the editor's author roster.
 *
 * ```tsx
 * function MyCard({ item }: { item: ReviewItemView }) {
 *   const author = useReviewAuthor(item.author);
 *   return <div style={{ borderColor: author?.color }}>…</div>;
 * }
 * <DocxEditorReview.List>{(item) => <MyCard item={item} />}</DocxEditorReview.List>;
 * ```
 *
 * @public
 */
export function useReviewAuthor(author: string | undefined): ReviewAuthorInfo | undefined {
  const rail = useContext(ReviewContext);
  const roster = useReviewAuthors();
  if (author === undefined) return undefined;
  return rail ? rail.authorInfo.get(author) : roster.find((info) => info.author === author);
}

export interface ReviewRailValue {
  /** The host's label resolver, when it passed one. Parts read through {@link useReviewLabel}. */
  readonly t: ToolbarTranslate | undefined;
  /** A card's className, from the rail's `card` prop. */
  readonly cardClassName: string | undefined;
  /** Viewing mode keeps review decisions visible but makes every mutation unavailable. */
  readonly readOnly: boolean;
  readonly review: ReturnType<typeof useReview>;
  /**
   * The UNFILTERED queue. The rail's cards render `review.items`, which the structural and
   * formatting defaults and the host's `filter` have already narrowed — but the balloon
   * exists precisely for the items those filters hide, so it matches against everything.
   */
  readonly allItems: readonly ReviewItemView[];
  /** Author colour slot per author, by order of first appearance. */
  readonly authorSlots: ReadonlyMap<string, number>;
  /**
   * The FACADE's resolved roster: the same derivation the painted document colours by, so
   * a card and its text cannot disagree about who draws in what — and the carrier of any
   * host-supplied per-author style (colour, wash, class names, avatar).
   */
  readonly authorInfo: ReadonlyMap<string, ReviewAuthorInfo>;
  /** The author and resolved presentation an omitted-author comment will receive. */
  readonly draftAuthor: string | null;
  readonly draftAuthorInfo: ReviewAuthorInfo | undefined;
  readonly draftAuthorSlot: number;
  /** Comment items by id, so a card can render its replies without walking the list. */
  readonly byId: ReadonlyMap<string, ReviewItemView>;
  /** Report a slot element so the rail can keep its measured height current. */
  readonly measure: (node: HTMLElement | null, key: string) => void;
  /** Open the compose box for the current selection. */
  readonly beginDraft: () => void;
  /** Close it, committed or not, and unpin the range. */
  readonly endDraft: () => void;
  /** The `commentMarkers` viewer preference: how a comment thread's margin marker looks. */
  readonly commentMarkers: CommentMarkers;
  /** The `revisionsIn` viewer preference: tracked changes as rail cards or page balloons. */
  readonly revisionsIn: RevisionsIn;
}

export function useRail(): ReviewRailValue {
  const value = useContext(ReviewContext);
  if (value) return value;
  // A part rendered outside the compound by mistake should show nothing, not throw in the
  // middle of someone's render.
  return INERT_RAIL;
}

/**
 * A part's strings: the host's `t`, else the bundled catalogue.
 *
 * The fallback is the packaged English, not the raw key — unlike the toolbar and menu bar,
 * whose labels are registry keys a host is expected to resolve, every string here ships one.
 */
export function useReviewLabel(): (key: TranslationKey) => string {
  const { t: hostT } = useContext(ReviewContext) ?? {};
  const { t } = useTranslation();
  return useCallback((key: TranslationKey) => hostT?.(key) ?? t(key), [hostT, t]);
}

export const INERT_RAIL: ReviewRailValue = {
  t: undefined,
  cardClassName: undefined,
  readOnly: false,
  review: {
    items: [],
    activeKey: null,
    setActive: () => false,
    accept: () => false,
    reject: () => false,
    adopt: () => false,
    resolve: () => false,
    reopen: () => false,
    commentResolutionDisabledReason: null,
    remove: () => false,
    reply: () => false,
    selectionAnchorY: null,
    comment: () => false,
    paneOpen: true,
    setPaneOpen: () => {},
    ready: false,
  },
  allItems: [],
  authorSlots: new Map(),
  authorInfo: new Map(),
  draftAuthor: null,
  draftAuthorInfo: undefined,
  draftAuthorSlot: 0,
  byId: new Map(),
  measure: () => {},
  beginDraft: () => {},
  endDraft: () => {},
  commentMarkers: 'avatar',
  revisionsIn: 'pane',
};

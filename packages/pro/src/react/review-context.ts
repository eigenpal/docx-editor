/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The rail's private contexts and the two public hooks that read them. The Vue twin is
// `../vue/review-context.ts`.

import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { TranslationKey } from '@docx-editor.dev/i18n';
import type { CommentMarkerStyle, RevisionDisplay } from '@docx-editor.dev/core/editor';
import {
  useReviewAuthors,
  useTranslation,
  type ReviewAuthorInfo,
  type ToolbarTranslate,
} from '@docx-editor.dev/react';
import type { useReview, ReviewItemView } from './useReview.ts';

/** The rail's data, provided once by the Root so a card never re-subscribes. */
export const ReviewContext = createContext<ReviewRailValue | null>(null);
/**
 * The part of the rail's data a card reads. It holds no item list, so an edit that changes
 * one item does not render the cards of the others. Parts inside a card read it through
 * {@link useCardRail}.
 */
export const ReviewCardRailContext = createContext<ReviewCardRailValue | null>(null);
/**
 * The items a card's replies resolve from, by id. Each place that renders a card provides it.
 * A card in the list gets only its own replies, which change only when one of them does; the
 * balloon and the compact card, one of each, get every item.
 */
export const ReviewThreadContext = createContext<ReadonlyMap<string, ReviewItemView> | null>(null);
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
  const rail = useContext(ReviewCardRailContext);
  const roster = useReviewAuthors();
  if (author === undefined) return undefined;
  return rail ? rail.authorInfo.get(author) : roster.find((info) => info.author === author);
}

/** The review hook's actions and state, without the fields that follow the item list. */
export type ReviewCardActions = Omit<
  ReturnType<typeof useReview>,
  'items' | 'activeKey' | 'activatedKey' | 'selectionAnchorY'
>;

/** What a part inside a card reads from the rail. None of it follows the item list. */
export interface ReviewCardRailValue {
  /** The host's label resolver, when it passed one. Parts read through {@link useReviewLabel}. */
  readonly t: ToolbarTranslate | undefined;
  /** A card's className, from the rail's `card` prop. */
  readonly cardClassName: string | undefined;
  /** Viewing mode keeps review decisions visible but makes every mutation unavailable. */
  readonly readOnly: boolean;
  readonly review: ReviewCardActions;
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
  /** Open the compose box for the current selection. */
  readonly beginDraft: () => void;
  /** Close it, committed or not, and unpin the range. */
  readonly endDraft: () => void;
  /** The `commentMarkers` review pane setting: how a comment thread's margin marker looks. */
  readonly commentMarkers: CommentMarkerStyle;
  /** The `revisionsIn` review pane setting: tracked changes as rail cards or page balloons. */
  readonly revisionsIn: RevisionDisplay;
}

/** Everything the rail's own parts read: the card's share plus the item lists and geometry. */
export interface ReviewRailValue extends Omit<ReviewCardRailValue, 'review'> {
  readonly review: ReturnType<typeof useReview>;
  /**
   * The UNFILTERED queue. The rail's cards render `review.items`, which the structural and
   * formatting defaults and the host's `filter` have already narrowed — but the balloon
   * exists precisely for the items those filters hide, so it matches against everything.
   */
  readonly allItems: readonly ReviewItemView[];
  /** Comment items by id, so a card can render its replies without walking the list. */
  readonly byId: ReadonlyMap<string, ReviewItemView>;
  /**
   * The ref callback for a slot element, by key: the same function on every render, so React
   * attaches the slot once. The rail updates only when a height changes.
   */
  readonly slotRef: (key: string) => (node: HTMLElement | null) => void;
  /** Whether a comment draft is open. A `Draft` part renders only while it is. */
  readonly drafting: boolean;
  /**
   * The packaged position of the compose box, in rail CSS pixels, or null when it has no
   * anchor. A `Draft` part without its own `top` uses it.
   */
  readonly composeTop: number | null;
  /** The compose box's rail-local `left` in the compact rail, or null in the full column. */
  readonly composeLeft: number | null;
}

export function useRail(): ReviewRailValue {
  const value = useContext(ReviewContext);
  if (value) return value;
  // A part rendered outside the compound by mistake should show nothing, not throw in the
  // middle of someone's render.
  return INERT_RAIL;
}

/**
 * The rail as a part inside a card reads it. It does not change when the item list does, so
 * a card renders again only for its own item, its replies, or the rail's settings.
 */
export function useCardRail(): ReviewCardRailValue {
  return useContext(ReviewCardRailContext) ?? INERT_RAIL;
}

/**
 * The review hook's value as a card reads it. Built from the fields themselves, so it keeps
 * its identity while each of them does, and a change of the item list does not replace it.
 */
export function useCardActions(review: ReturnType<typeof useReview>): ReviewCardActions {
  const {
    setActive,
    accept,
    reject,
    adopt,
    resolve,
    reopen,
    commentResolutionDisabledReason,
    remove,
    reply,
    edit,
    comment,
    lastRefusal,
    paneOpen,
    setPaneOpen,
    ready,
  } = review;
  return useMemo<ReviewCardActions>(
    () => ({
      setActive,
      accept,
      reject,
      adopt,
      resolve,
      reopen,
      commentResolutionDisabledReason,
      remove,
      reply,
      edit,
      comment,
      lastRefusal,
      paneOpen,
      setPaneOpen,
      ready,
    }),
    [
      setActive,
      accept,
      reject,
      adopt,
      resolve,
      reopen,
      commentResolutionDisabledReason,
      remove,
      reply,
      edit,
      comment,
      lastRefusal,
      paneOpen,
      setPaneOpen,
      ready,
    ]
  );
}

/**
 * `next`, or the value this hook returned before when `same` says the two are equal. Keeps
 * the identity of a derived value whose content did not change, so memos that depend on it hold.
 *
 * The kept value is state, replaced while rendering when the content changes. React then
 * renders the component again at once, before its children, with the new value. A render that
 * React drops takes its update along, so the hook is safe in StrictMode and in concurrent
 * rendering. `next` must be equal by `same` from one render to the next while nothing changed,
 * as a prop or a memoized value is, or the renders do not end.
 */
export function useKept<T>(next: T, same: (a: T, b: T) => boolean): T {
  const [kept, setKept] = useState(next);
  if (kept === next || same(kept, next)) return kept;
  setKept(next);
  return next;
}

/**
 * A part's strings: the host's `t`, else the bundled catalogue.
 *
 * The fallback is the packaged English, not the raw key — unlike the toolbar and menu bar,
 * whose labels are registry keys a host is expected to resolve, every string here ships one.
 */
/** Placeholder values for a review label, such as `{ count: 3 }` for `{count}`. */
export type ReviewLabelParams = Readonly<Record<string, string | number>>;

/** Fill `{name}` placeholders in a host-translated label, the way the catalogue's `t()` does. */
function withParams(text: string, params: ReviewLabelParams | undefined): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : whole
  );
}

export function useReviewLabel(): (key: TranslationKey, params?: ReviewLabelParams) => string {
  const { t: hostT } = useContext(ReviewCardRailContext) ?? {};
  const { t } = useTranslation();
  return useCallback(
    (key: TranslationKey, params?: ReviewLabelParams) => {
      const host = hostT?.(key);
      return host !== undefined ? withParams(host, params) : t(key, params);
    },
    [hostT, t]
  );
}

const NO_SLOT_REF = (): void => {};

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
    edit: () => false,
    selectionAnchorY: null,
    comment: () => false,
    lastRefusal: null,
    activatedKey: null,
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
  slotRef: () => NO_SLOT_REF,
  beginDraft: () => {},
  endDraft: () => {},
  drafting: false,
  composeTop: null,
  composeLeft: null,
  commentMarkers: 'icon',
  revisionsIn: 'pane',
};

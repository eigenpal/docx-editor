/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// `DocxEditor.Review` — the review rail: every pending decision in the document, as cards
// beside the page it belongs to.
//
// One card per DECISION, not per site. A tracked row insertion is `w:trPr/w:ins` on the row
// plus a `w:cellIns` on every cell; a reviewer is being asked one question about it, so they
// get one card and one pair of buttons, and accepting resolves every site in one undo step.
//
// CUSTOMIZATION LADDER, the same five rungs `DocxEditorToolbar` and `DocxEditor.HyperLink`
// establish:
//
//   1. `className` / `data-*`      restyle the packaged parts with CSS
//   2. `icon`                      swap one part's glyph
//   3. `asChild`                   merge a part's wiring onto your own element
//   4. in-place part override      a `<Review.Accept>` child replaces that slot;
//                                  `hidden` removes it; `preset={false}` drops the defaults.
//                                  `<Review.List>` also takes a RENDER PROP, for a host that
//                                  keeps the rail and its positioning but not the card.
//   5. `useReview()`               the raw hook, for a surface with nothing in common with this
//
// Every string is an i18n key and every colour a `--doc-*` token, so nobody has to fork this
// to translate or theme it. Test ids are stable and unlocalized.
//
// POSITIONING. A card sits at its anchor's Y, which comes from LAYOUT RECORDS through the
// hook — never from measuring painted DOM, which is a repaint behind the document and breaks
// outright while pagination is in flight. Layout points become pixels through the engine's
// zoom, and the rail offsets by the painted surface's own position so it stays aligned when
// the host puts chrome above the pages.

import {
  Fragment,
  cloneElement,
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { ReviewItemQuery, ReviewRevisionKind } from '@docx-editor.dev/core/contracts/editor';
import type { TranslationKey } from '@docx-editor.dev/i18n';
import { ReviewRailContext, Slot, useDocxEditor, useTranslation } from '@docx-editor.dev/react';
import { useReview, type ReviewItemView } from './useReview';

/** The rail's data, provided once by the Root so a card never re-subscribes. */
const ReviewContext = createContext<ReviewRailValue | null>(null);
/** The card being rendered, so every part inside it reads one item. */
const ReviewItemContext = createContext<ReviewItemView | null>(null);

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

interface ReviewRailValue {
  readonly review: ReturnType<typeof useReview>;
  /**
   * The UNFILTERED queue. The rail's cards render `review.items`, which the structural and
   * formatting defaults and the host's `filter` have already narrowed — but the balloon
   * exists precisely for the items those filters hide, so it matches against everything.
   */
  readonly allItems: readonly ReviewItemView[];
  /** Author colour slot per author, by order of first appearance — Word's own rule. */
  readonly authorSlots: ReadonlyMap<string, number>;
  /** Comment items by id, so a card can render its replies without walking the list. */
  readonly byId: ReadonlyMap<string, ReviewItemView>;
  /** Report a slot element so the rail can keep its measured height current. */
  readonly measure: (node: HTMLElement | null, key: string) => void;
  /** Open the compose box for the current selection. */
  readonly beginDraft: () => void;
  /** Close it, committed or not, and unpin the range. */
  readonly endDraft: () => void;
}

/** Where the rail is, in the coordinates of its positioning container. */
interface RailMetrics {
  /** Layout points to CSS pixels, from the engine. */
  readonly scale: number;
  /** The painted surface's own top offset, so chrome above the pages does not shift cards. */
  readonly top: number;
  /** Left edge, one gutter right of the sheet; null until there is a surface to measure. */
  readonly left: number | null;
}

const INITIAL_METRICS: RailMetrics = { scale: 96 / 72, top: 0, left: null };

/** Space between the page edge and the cards. */
const RAIL_GUTTER = 16;

/** The compose affordance's place in the stacking run. Not a review item; never rendered. */
const COMPOSE_KEY = '\u0000compose';

/**
 * How far outside the visible scroll window a card still mounts, in pixels.
 *
 * Enough that a normal scroll or a pane toggle never shows an empty gutter, small enough
 * that a document with two hundred comments mounts a handful of cards rather than all of
 * them. Rendering every card was the toggle's lag: two hundred cards' worth of DOM, plus a
 * `top` transition on each, in one frame.
 */
const RAIL_OVERSCAN = 600;

/** How many author slots the token ramp defines; past it, colours repeat. */
const AUTHOR_SLOTS = 8;

/** What an unmeasured, uncollapsed card reserves in the stacking run, in CSS px. */
const DEFAULT_CARD_HEIGHT = 72;
/** A collapsed card: the head row and its padding, in CSS px. */
const COLLAPSED_CARD_HEIGHT = 64;
/**
 * How far (CSS px) a card may be pushed below its own text before it collapses to a
 * header. Roughly half a viewport: nearer than that the eye still connects card to text;
 * further, a full card reads as annotating whatever happens to be beside it.
 */
const COLLAPSE_DISPLACEMENT_PX = 480;

/** Stable query for the balloon's unplaced queue read — never allocate per render. */
const NO_PLACEMENT_REVIEW_QUERY = Object.freeze({ placement: false }) satisfies ReviewItemQuery;

/**
 * Whether this entry renders INSIDE another card rather than as one of its own.
 *
 * Two kinds of reply, one rule. A threaded reply belongs in the comment it answers; a reply to
 * a TRACKED CHANGE is also a comment — OOXML gives `w:ins` and `w:del` no body, so the text is
 * written over the change's own range — and belongs in the change's card. Everywhere the rail
 * lists roots asks this, because a filter that checked only `parentId` drew a reply to a
 * revision twice: once inside the change and once beside it.
 */
function isThreadedReply(entry: ReviewItemView): boolean {
  return (
    entry.kind === 'comment' &&
    (entry.parentId !== undefined || entry.parentRevisionId !== undefined)
  );
}

/** Keeps the caret: a mousedown that bubbles to the editor moves it. Inputs are exempt. */
function guardMousedown(event: React.MouseEvent): void {
  const tag = (event.target as HTMLElement | null)?.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  event.preventDefault();
}

function useRail(): ReviewRailValue {
  const value = useContext(ReviewContext);
  if (value) return value;
  // A part rendered outside the compound by mistake should show nothing, not throw in the
  // middle of someone's render.
  return INERT_RAIL;
}

const INERT_RAIL: ReviewRailValue = {
  review: {
    items: [],
    activeKey: null,
    setActive: () => {},
    accept: () => {},
    reject: () => {},
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
  byId: new Map(),
  measure: () => {},
  beginDraft: () => {},
  endDraft: () => {},
};

/** Shared props for every part. @public */
export interface ReviewPartProps {
  className?: string;
  /** Merge this part's wiring onto the single child element instead of the default one. */
  asChild?: boolean;
  /** Render nothing — inside the packaged arrangement this removes the part. */
  hidden?: boolean;
  children?: ReactNode;
}

/** Props for the action parts, which also take an icon. @public */
export interface ReviewActionProps extends ReviewPartProps {
  /** Icon override; falls back to `children`, then to the part's default glyph. */
  icon?: ReactNode;
}

/** Props for `DocxEditor.Review`. @public */
export interface ReviewProps extends ReviewPartProps {
  /**
   * Host furniture rendered at the top of the rail, above the cards — filters,
   * legends, custom summaries (pro-review-and-custom-nodes task 4.11). Plain
   * flow content; per-item custom CARDS (4.10 reviewCard) are the follow-up.
   */
  furniture?: ReactNode;
  /**
   * Render the packaged arrangement. `false` mounts the rail and its context only, so a host
   * can lay the cards out itself while keeping the subscription and the anchoring.
   */
  preset?: boolean;
  /**
   * Stack cards so they never overlap, pushing later ones down. `false` leaves every card on
   * its raw anchor, which is right for a rail that draws connectors instead.
   */
  stack?: boolean;
  /** Gap (px) between stacked cards. The only source of vertical spacing in the rail. */
  gap?: number;
  /** Show only some of the queue — comments in one rail, revisions in another. */
  filter?: (item: ReviewItemView) => boolean;
  /**
   * Show the "changed the document structure" cards. Default `false`: a heavily revised
   * document carries one per structural site and together they crowd out the cards a
   * reviewer can act on. The revisions stay marked in the document, where clicking one
   * opens its balloon — this hides only their rail cards.
   */
  structural?: boolean;
  /**
   * Show the "changed text formatting" cards. Default `false`, same reasoning as
   * {@link structural}: a restyled document mints one per run, and the decision is
   * reachable by clicking the grey-marked text instead. The rail keeps the decisions a
   * reviewer reads in order — content changes and comments.
   */
  formatting?: boolean;
}

// Inline SVG, like the toolbar's icons: this package ships no icon font.
const icon = (path: string): ReactNode => (
  <svg viewBox="0 -960 960 960" width={16} height={16} aria-hidden="true" focusable="false">
    <path d={path} fill="currentColor" />
  </svg>
);

const ADD_COMMENT_ICON =
  'M440-400h80v-120h120v-80H520v-120h-80v120H320v80h120v120ZM80-80v-720q0-33 23.5-56.5T160-880h640q33 0 56.5 23.5T880-800v480q0 33-23.5 56.5T800-240H240L80-80Zm126-240h594v-480H160v525l46-45Zm-46 0v-480 480Z';
const COMMENT_ICON =
  'M240-400h480v-80H240v80Zm0-120h480v-80H240v80Zm0-120h480v-80H240v80ZM880-80 720-240H160q-33 0-56.5-23.5T80-320v-480q0-33 23.5-56.5T160-880h640q33 0 56.5 23.5T880-800v720ZM160-320h594l46 45v-525H160v480Zm0 0v-480 480Z';
const ACCEPT_ICON = 'M382-240 154-468l57-57 171 171 367-367 57 57-424 424Z';
const REJECT_ICON =
  'm256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z';
/**
 * A TRASH can, not the reject X.
 *
 * Deliberately a different glyph from {@link REJECT_ICON} even though both sit in the same
 * actions row and both discard something. On a revision card the two would otherwise read as
 * the same button drawn twice, and the destructive one — deleting a reviewer's remark outright
 * — is the one that must not be reached for by mistake.
 */
const DELETE_ICON =
  'M280-120q-33 0-56.5-23.5T200-200v-520h-40v-80h200v-40h240v40h200v80h-40v520q0 33-23.5 56.5T680-120H280Zm400-600H280v520h400v-520ZM360-280h80v-360h-80v360Zm160 0h80v-360h-80v360ZM280-720v520-520Z';

/**
 * The review rail.
 *
 * Positions absolutely inside the nearest positioned ancestor — put it in
 * `DocxEditor.Viewport` beside `DocxEditor.Content`, which is what makes the cards scroll
 * with the pages without a scroll listener.
 *
 * @public
 */
function ReviewRoot({
  className,
  furniture,
  asChild,
  hidden,
  children,
  preset = true,
  stack = true,
  gap = 8,
  filter,
  structural = false,
  formatting = false,
}: ReviewProps) {
  const editor = useDocxEditor();
  const excludeRevisionKinds = useMemo((): readonly ReviewRevisionKind[] | undefined => {
    const excluded: ReviewRevisionKind[] = [];
    if (!structural) excluded.push('structural');
    if (!formatting) excluded.push('format');
    return excluded.length > 0 ? excluded : undefined;
  }, [structural, formatting]);

  const railQuery = useMemo(
    () => (excludeRevisionKinds ? { excludeRevisionKinds } : undefined),
    [excludeRevisionKinds]
  );

  const allReview = useReview(NO_PLACEMENT_REVIEW_QUERY);
  const review = useReview(railQuery);
  const setReviewPaneOpen = review.setPaneOpen;
  const { t } = useTranslation();
  const railRef = useRef<HTMLElement | null>(null);
  // Claim the gutter. Without this the viewport reserved it for every consumer, mounted
  // rail or not, and the tier-2 `<DocxEditor>` sugar mounts none.
  const railRegistry = useContext(ReviewRailContext);
  useEffect(() => railRegistry?.register(), [railRegistry]);
  // The pane's open state is the ENGINE's, not this component's: the toolbar toggles it and
  // the viewport shifts the page for it, so a flag kept here would be a third opinion.
  const open = review.paneOpen;

  const items = useMemo(() => {
    return filter ? review.items.filter((entry) => filter(entry)) : review.items;
  }, [review.items, filter]);

  // Word's rule: a colour per author by ORDER OF FIRST APPEARANCE. A hash of the name is
  // stable but collides, and two reviewers drawn in one colour tells the reader the wrong
  // thing about who proposed what.
  const authorSlots = useMemo(() => {
    const slots = new Map<string, number>();
    for (const entry of items) {
      if (entry.author && !slots.has(entry.author)) slots.set(entry.author, slots.size);
    }
    return slots;
  }, [items]);

  const byId = useMemo(() => {
    const map = new Map<string, ReviewItemView>();
    for (const entry of items) map.set(entry.id, entry);
    return map;
  }, [items]);

  // Card heights are the CALLER's to report: only the rendered card knows how tall it is, and
  // a rail that guessed would overlap the moment a comment ran to three lines.
  const [heights, setHeights] = useState<ReadonlyMap<string, number>>(() => new Map());
  const measure = useCallback((key: string, height: number) => {
    // A real card is never 0px tall — zero is a layout-less read (a DOM without a
    // renderer, or a mid-transition detach), and recording it collapses the stacking run
    // to gaps. The content-derived estimate keeps standing in until a real height lands.
    if (height <= 0) return;
    setHeights((previous) => {
      if (previous.get(key) === height) return previous;
      const next = new Map(previous);
      next.set(key, height);
      return next;
    });
  }, []);

  // OBSERVED, not read once on render. A card changes height on its own — the reply box opens
  // when it becomes active, a web font lands, a summary rewraps — and a height read during
  // commit and never revisited left the stack spacing every card below it by a size that card
  // no longer was. The visible symptom was a band of empty rail under a card that had just
  // collapsed. A key keeps its last height when virtualization unmounts its card, which is
  // deliberate: dropping it would collapse the run and jump every card on screen.
  const slotSizes = useRef(new WeakMap<Element, string>());
  const sizeObserver = useRef<ResizeObserver | null>(null);
  const observeSlot = useCallback(
    (node: HTMLElement | null, key: string) => {
      if (!node || typeof ResizeObserver === 'undefined') return;
      measure(key, node.offsetHeight);
      sizeObserver.current ??= new ResizeObserver((entries) => {
        for (const entry of entries) {
          const owner = slotSizes.current.get(entry.target);
          if (owner) measure(owner, (entry.target as HTMLElement).offsetHeight);
        }
      });
      if (slotSizes.current.get(node) === key) return;
      slotSizes.current.set(node, key);
      sizeObserver.current.observe(node);
    },
    [measure]
  );
  useEffect(() => () => sizeObserver.current?.disconnect(), []);

  // Where the rail sits, measured from the PAINTED SURFACE rather than from the viewport.
  //
  // Both halves matter. Vertically, the surface's own offset inside the scroll container is
  // whatever chrome the host put above the pages — without it every card is drawn that far
  // too high. Horizontally, the page is centred in a viewport that is usually much wider, so
  // a rail pinned to the right edge floats away from the page it annotates; it belongs one
  // gutter to the right of the sheet, and it moves with the sheet when the window resizes or
  // the zoom changes.
  const [metrics, setMetrics] = useState<RailMetrics>(INITIAL_METRICS);
  useEffect(() => {
    const rail = railRef.current;
    if (!editor || !rail) return undefined;
    const parent = rail.offsetParent as HTMLElement | null;
    const surface = parent?.querySelector<HTMLElement>('.docx-paginated-surface') ?? null;
    const sync = (): void => {
      setMetrics((previous) => {
        const next: RailMetrics = {
          // The engine's own points-to-pixels factor, zoom included. Deriving it here from
          // `getZoom()` alone dropped the 96/72 and put every card at three quarters height.
          scale: editor.getRenderScale(),
          top: surface ? surface.offsetTop : 0,
          left: surface ? surface.offsetLeft + surface.offsetWidth + RAIL_GUTTER : null,
        };
        return previous.scale === next.scale &&
          previous.top === next.top &&
          previous.left === next.left
          ? previous
          : next;
      });
    };
    sync();
    const observer = new ResizeObserver(sync);
    if (parent) observer.observe(parent);
    if (surface) observer.observe(surface);
    return () => observer.disconnect();
    // Re-measured whenever the queue could have moved: a new page above an anchor changes
    // where its card belongs, and zoom changes every anchor at once.
  }, [editor, items]);

  // Clicking the canvas AROUND the page closes the open item. The caret decides everything
  // else, but a click on the grey moves no caret, so nothing else would ever put a card away.
  // Deliberately narrow: a click inside the page is the caret's business, and a click on the
  // toolbar must not close the card whose text is about to be formatted.
  useEffect(() => {
    const rail = railRef.current;
    if (!editor || !rail) return undefined;
    const onMouseDown = (event: MouseEvent): void => {
      const target = event.target;
      if (!(target instanceof Node) || rail.contains(target)) return;
      const container = rail.offsetParent as HTMLElement | null;
      if (!container || !container.contains(target)) return;
      const surface = container.querySelector('.docx-paginated-surface');
      if (surface?.contains(target)) return;
      editor.setActiveReviewItem(null);
    };
    // Capture: the surface calls `preventDefault` on its own pointer handling, and a
    // bubbling listener never sees a click that lands on the pages layer.
    document.addEventListener('mousedown', onMouseDown, true);
    return () => document.removeEventListener('mousedown', onMouseDown, true);
  }, [editor]);

  // The visible band of the scroller, in the rail's own coordinates. Passive listener,
  // coalesced into a frame: the handler runs on every wheel tick and must do nothing but
  // record two numbers.
  const [window_, setWindow] = useState<{ top: number; bottom: number } | null>(null);
  useEffect(() => {
    const rail = railRef.current;
    const scroller = rail?.offsetParent as HTMLElement | null;
    if (!scroller) return undefined;
    let frame = 0;
    const sync = (): void => {
      frame = 0;
      setWindow((previous) => {
        const top = scroller.scrollTop - RAIL_OVERSCAN;
        const bottom = scroller.scrollTop + scroller.clientHeight + RAIL_OVERSCAN;
        return previous && previous.top === top && previous.bottom === bottom
          ? previous
          : { top, bottom };
      });
    };
    // While the reader scrolls, the slots' `top` transition is suppressed (a DOM attribute
    // so no React work happens at scroll frequency). Restacks DURING a scroll come from
    // cards entering the window and correcting an estimated height to a measured one; each
    // correction shifts every card below it, and ANIMATING those shifts while the page
    // itself moves read as a second, faster scroll layered over the document.
    let settle = 0;
    const onScroll = (): void => {
      if (frame === 0) frame = requestAnimationFrame(sync);
      rail?.setAttribute('data-scrolling', '');
      window.clearTimeout(settle);
      settle = window.setTimeout(() => rail?.removeAttribute('data-scrolling'), 150);
    };
    sync();
    scroller.addEventListener('scroll', onScroll, { passive: true });
    const observer = new ResizeObserver(onScroll);
    observer.observe(scroller);
    return () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      window.clearTimeout(settle);
      scroller.removeEventListener('scroll', onScroll);
      observer.disconnect();
    };
  }, [editor]);

  // A comment being composed, before anything is written. Held here rather than committed
  // empty: an empty `w:comment` is a real comment in the file, and abandoning the box would
  // leave one behind for every time someone changed their mind.
  const [draftAnchorY, setDraftAnchorY] = useState<number | null>(null);
  const beginDraft = useCallback(() => {
    if (!editor) return;
    // Pin the range before the compose box takes focus, or the browser drops the highlight
    // off the very words the comment is about.
    editor.surface?.retainSelection();
    setReviewPaneOpen(true);
    setDraftAnchorY(editor.getSelectionPlacement()?.anchorY ?? null);
  }, [editor, setReviewPaneOpen]);
  const endDraft = useCallback(() => {
    editor?.surface?.releaseSelection();
    setDraftAnchorY(null);
    // Back to the document. Closing the box unmounts it, and without this the user landed on
    // `<body>` with Tab restarting at the top of the page.
    editor?.focus();
  }, [editor]);
  useEffect(() => {
    if (open || draftAnchorY === null) return;
    // Closing the pane abandons its uncommitted draft. Release the pinned range without
    // moving focus away from the toolbar control that closed it.
    editor?.surface?.releaseSelection();
    setDraftAnchorY(null);
  }, [open, draftAnchorY, editor]);

  // The compose CARD stacks with the cards, because it is one: rendered outside the run it
  // landed on top of the card whose text had just been re-selected, and its anchor IS that
  // card's anchor, so nothing about its own position could have avoided the collision. The
  // BUTTON does not stack — it sits against the page instead, where nothing else is.
  const composeAnchorY = draftAnchorY ?? review.selectionAnchorY;
  // Only what the list RENDERS competes for the column: a threaded reply lives inside its
  // parent's card, and letting it into the run advanced the cursor once per reply, spacing
  // every card below a commented conversation by gaps nothing on screen accounted for.
  const roots = useMemo(() => items.filter((entry) => !isThreadedReply(entry)), [items]);
  const stackInput = useMemo(() => {
    if (draftAnchorY === null) return roots;
    // In document order, AFTER anything already at that height: the comments already there
    // were made before this selection, and later is below.
    const at = roots.findIndex((entry) => entry.anchorY !== null && entry.anchorY > draftAnchorY);
    const compose = { key: COMPOSE_KEY, anchorY: draftAnchorY };
    return at === -1 ? [...roots, compose] : [...roots.slice(0, at), compose, ...roots.slice(at)];
  }, [roots, draftAnchorY]);

  // An unmeasured card — below the virtualization window, or in its first frame — reserves
  // an estimate derived from ITS OWN text, not a flat constant. The estimate's error is the
  // distance every card below it jumps at the moment the real measurement lands, and with
  // hundreds of cards those corrections during a scroll compounded into the rail visibly
  // sliding against the page. Card chrome (padding, head, gaps) is ~64px; summary lines
  // wrap at roughly 36 characters of 20px line height.
  const estimatedHeights = useMemo(() => {
    const merged = new Map(heights);
    for (const entry of roots) {
      if (merged.has(entry.key)) continue;
      const textLength =
        entry.text.length + (entry.kind === 'revision' ? (entry.replacedText?.length ?? 0) : 0);
      const lines = Math.min(6, Math.max(1, Math.ceil(textLength / 36)));
      merged.set(entry.key, 64 + lines * 20);
    }
    return merged;
  }, [heights, roots]);

  const { stacked, collapsedKeys } = useMemo(() => {
    const scale = metrics.scale;
    const positions = new Map<string, number>();
    const collapsed = new Set<string>();
    let cursor = Number.NEGATIVE_INFINITY;
    for (const entry of stackInput) {
      // Geometry can be unavailable for an otherwise valid review item (for example while
      // its distant page has not produced a placement). Leaving that slot without `top`
      // puts it back into normal flow at the start of this relative container, underneath
      // the absolutely positioned cards. Keep it in the same column after the preceding
      // card instead; when geometry arrives a later pass can move it to its true anchor.
      const top =
        entry.anchorY === null
          ? Number.isFinite(cursor)
            ? cursor
            : 0
          : Math.max(entry.anchorY, cursor);
      positions.set(entry.key, top);
      const displacedPx = entry.anchorY === null ? 0 : (top - entry.anchorY) * scale;
      const isActive = 'isActive' in entry && entry.isActive;
      const collapse =
        displacedPx > COLLAPSE_DISPLACEMENT_PX && !isActive && entry.key !== COMPOSE_KEY;
      if (collapse) collapsed.add(entry.key);
      const height = collapse
        ? COLLAPSED_CARD_HEIGHT
        : (estimatedHeights.get(entry.key) ?? DEFAULT_CARD_HEIGHT);
      cursor = top + (height + gap) / scale;
    }
    return { stacked: positions, collapsedKeys: collapsed };
  }, [stackInput, estimatedHeights, gap, metrics.scale]);
  const composeTop =
    composeAnchorY === null
      ? null
      : metrics.top + (stacked.get(COMPOSE_KEY) ?? composeAnchorY) * metrics.scale;

  const value = useMemo<ReviewRailValue>(
    () => ({
      review: { ...review, items },
      allItems: allReview.items,
      authorSlots,
      byId,
      measure: observeSlot,
      beginDraft,
      endDraft,
    }),
    [review, allReview.items, items, authorSlots, byId, observeSlot, beginDraft, endDraft]
  );

  if (hidden) return null;

  const shared = {
    ref: railRef as React.Ref<HTMLElement>,
    className: `docx-review${className ? ` ${className}` : ''}`,
    'data-testid': 'review-rail',
    'data-count': items.length,
    'data-open': open ? '' : undefined,
    role: 'complementary' as const,
    'aria-label': t('review.ariaLabel'),
    onMouseDown: guardMousedown,
    // `right: 0` from the stylesheet is the fallback for a host with no painted surface to
    // measure; once there is one, the rail is placed against its edge instead.
    style: metrics.left === null ? undefined : { left: metrics.left, right: 'auto' },
  };

  // Root-level slots a child can replace in place. Collected but never consumed, six of the
  // fourteen parts advertised the override rung and silently did nothing.
  const rootParts = partOverrides(children);
  const takeRoot = (key: string, fallback: ReactNode): ReactNode =>
    key in rootParts ? rootParts[key] : fallback;

  const affordances = preset ? (
    <>
      {takeRoot(
        'AddComment',
        <ReviewAddComment top={composeTop} drafting={draftAnchorY !== null} />
      )}
      {!open || draftAnchorY === null || composeTop === null
        ? null
        : takeRoot('Draft', <ReviewDraft top={composeTop} />)}
      {/* Mounted open OR closed: the balloon is how a reader inspects a change whose rail
          card is filtered away, and a closed pane filters ALL of them away. */}
      {takeRoot('Balloon', <ReviewBalloon />)}
    </>
  ) : null;

  const body = !preset
    ? children
    : open
      ? takeRoot(
          'List',
          <ReviewList
            stack={stack}
            positions={stacked}
            collapsed={collapsedKeys}
            scale={metrics.scale}
            offset={metrics.top}
            window={window_}
          >
            {children}
          </ReviewList>
        )
      : // Closed, the rail keeps its anchors and drops everything else: a small marker per item
        // in the margin, which is how a reader sees there is something to read without giving up
        // the width. Clicking one opens the pane on that item.
        takeRoot(
          'Markers',
          <ReviewMarkers scale={metrics.scale} offset={metrics.top} window={window_} />
        );

  return (
    <ReviewContext.Provider value={value}>
      {asChild && isValidElement(children) ? (
        // The child becomes the rail ELEMENT and keeps its own children; the rail's content
        // is appended after them. Two earlier shapes were wrong: rendering `children` alone
        // mounted an empty element with no cards, and cloning it while ALSO passing it down
        // as the card preset rendered the consumer's element once per card.
        <Slot {...shared}>
          {cloneElement(
            children as React.ReactElement<{ children?: ReactNode }>,
            undefined,
            (children as React.ReactElement<{ children?: ReactNode }>).props.children,
            preset ? (
              <ReviewList
                stack={stack}
                positions={stacked}
                collapsed={collapsedKeys}
                scale={metrics.scale}
                offset={metrics.top}
                window={window_}
              />
            ) : null,
            affordances
          )}
        </Slot>
      ) : (
        <aside {...shared}>
          {furniture !== undefined ? (
            <div className="docx-review__furniture" data-testid="review-furniture">
              {furniture}
            </div>
          ) : null}
          {body}
          {affordances}
        </aside>
      )}
    </ReviewContext.Provider>
  );
}

interface ReviewListProps {
  stack?: boolean;
  positions?: ReadonlyMap<string, number>;
  /** Cards the stacking pass collapsed to a header — pushed too far from their text. */
  collapsed?: ReadonlySet<string>;
  scale?: number;
  offset?: number;
  /** Visible band of the scroller; cards outside it are not mounted. Null renders all. */
  window?: { top: number; bottom: number } | null;
  /**
   * A render prop takes over the card entirely, keeping the rail's subscription, anchoring
   * and stacking. Nodes are treated as part overrides for the packaged card.
   */
  children?: ReactNode | ((item: ReviewItemView) => ReactNode);
  className?: string;
  hidden?: boolean;
}

/**
 * The cards, each positioned at its anchor.
 *
 * REPLIES are not cards. A threaded reply belongs inside the comment it answers, and giving
 * it a card of its own would put two entries in the rail for one conversation.
 *
 * @public
 */
function ReviewList({
  stack = true,
  positions,
  collapsed,
  scale = 1,
  offset = 0,
  window: visible = null,
  children,
  className,
  hidden,
}: ReviewListProps) {
  const { review, measure } = useRail();
  if (hidden) return null;

  const roots = review.items.filter((entry) => !isThreadedReply(entry));

  if (roots.length === 0) {
    return typeof children === 'function' ? null : <ReviewEmpty />;
  }

  return (
    <div className={`docx-review__list${className ? ` ${className}` : ''}`}>
      {roots.map((entry) => {
        const anchor = stack ? (positions?.get(entry.key) ?? entry.anchorY) : entry.anchorY;
        const top = anchor === null || anchor === undefined ? null : offset + anchor * scale;
        // Outside the window: not rendered at all. A card the reader cannot see costs a
        // subtree, a measurement and a transition, and two hundred of them cost a frame.
        if (top !== null && visible && (top < visible.top || top > visible.bottom)) return null;
        const style: CSSProperties = top === null ? {} : { position: 'absolute', top };
        return (
          <ReviewItemContext.Provider key={entry.key} value={entry}>
            <div
              className="docx-review__slot"
              style={style}
              // Header-only, because the card sits far from the text it annotates and a
              // full summary there reads as annotating the wrong text. Clicking it makes
              // the item active, and the active card always renders in full.
              {...(collapsed?.has(entry.key) ? { 'data-collapsed': '' } : {})}
              ref={(node) => {
                measure(node, entry.key);
              }}
            >
              {typeof children === 'function' ? (
                children(entry)
              ) : (
                <ReviewCard>{children}</ReviewCard>
              )}
            </div>
          </ReviewItemContext.Provider>
        );
      })}
    </div>
  );
}
ReviewList.docxReviewPart = 'List' as const;

/**
 * The collapsed rail: one marker per item, at its anchor.
 *
 * @public
 */
function ReviewMarkers({
  scale = 1,
  offset = 0,
  window: visible = null,
  className,
  hidden,
}: {
  scale?: number;
  offset?: number;
  /** Visible band of the scroller; markers outside it are not mounted. */
  window?: { top: number; bottom: number } | null;
  className?: string;
  hidden?: boolean;
}) {
  const { review } = useRail();
  const { t } = useTranslation();
  if (hidden) return null;
  const roots = review.items.filter((entry) => !isThreadedReply(entry));
  return (
    <div className={`docx-review__markers${className ? ` ${className}` : ''}`}>
      {roots.map((entry) => {
        if (entry.anchorY === null) return null;
        const top = offset + entry.anchorY * scale;
        if (visible && (top < visible.top || top > visible.bottom)) return null;
        return (
          <button
            key={entry.key}
            type="button"
            className="docx-review__marker"
            data-testid="review-marker"
            data-kind={entry.kind === 'revision' ? entry.revisionKind : entry.kind}
            style={{ position: 'absolute', top }}
            // A custom card has no author; leading its tooltip with ": " read as a glitch.
            title={entry.author ? `${entry.author}: ${entry.text}` : entry.text}
            // The author and the words, not a generic "show pane" — with the label the same
            // on every marker a screen reader heard N identical buttons and never learned
            // who said what.
            aria-label={`${t('review.showPane')}: ${entry.author ? `${entry.author}. ` : ''}${entry.text}`}
            onMouseDown={guardMousedown}
            onClick={() => {
              // Open the pane AND put the caret in this item's text, so the card the reader
              // asked for is the one that unfolds.
              review.setPaneOpen(true);
              review.setActive(entry.key);
            }}
          >
            {icon(COMMENT_ICON)}
          </button>
        );
      })}
    </div>
  );
}
ReviewMarkers.docxReviewPart = 'Markers' as const;

/**
 * The "comment on this" button, beside the selected text.
 *
 * Appears only for a RANGE. A comment on a caret has nothing to point at, and Word writes
 * none, so the affordance is absent rather than present-and-refusing.
 *
 * @public
 */
function ReviewAddComment({
  top,
  drafting = false,
  className,
  hidden,
  children,
}: ReviewPartProps & { top: number | null; drafting?: boolean }) {
  const { beginDraft } = useRail();
  const { t } = useTranslation();
  // Offered for ANY range, including one inside an existing comment: overlapping comments
  // are ordinary in OOXML and ordinary in Word, and a reader picking out three words of a
  // commented sentence usually has something new to say about exactly those words. This used
  // to hide whenever a card was open, which was really a fix for the button landing on top of
  // that card — solved instead by moving it onto the page edge, where nothing else sits.
  if (hidden || drafting || top === null) return null;
  const shared = {
    type: 'button' as const,
    className: `docx-review__add${className ? ` ${className}` : ''}`,
    'data-testid': 'review-add-comment',
    style: { position: 'absolute' as const, top },
    'aria-label': t('common.comment'),
    title: t('common.comment'),
    // Keeps the selection: a mousedown that reaches the surface collapses the very range
    // this button is offering to comment on.
    onMouseDown: guardMousedown,
    onClick: beginDraft,
  };
  if (children) return <Slot {...shared}>{children}</Slot>;
  return <button {...shared}>{icon(ADD_COMMENT_ICON)}</button>;
}
ReviewAddComment.docxReviewPart = 'AddComment' as const;

/**
 * The compose box for a new comment.
 *
 * Nothing is written until it is submitted: an empty `w:comment` is a real comment in the
 * file, and committing on open would leave one behind every time somebody changed their mind.
 *
 * @public
 */
function ReviewDraft({ top, className, hidden }: ReviewPartProps & { top: number }) {
  const { review, endDraft, measure } = useRail();
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [refused, setRefused] = useState(false);
  const fieldRef = useRef<HTMLInputElement | null>(null);
  const fieldId = useId();

  useEffect(() => {
    // `preventScroll`: this input lives inside the document's scroller, and focusing it
    // normally would scroll the reader away from the text they just selected.
    fieldRef.current?.focus({ preventScroll: true });
  }, []);

  const submit = useCallback(() => {
    if (text.trim().length === 0) return;
    const landed = review.comment(text.trim());
    setRefused(!landed);
    if (landed) {
      setText('');
      endDraft();
    }
  }, [text, review, endDraft]);

  if (hidden) return null;
  return (
    <div
      className={`docx-review__slot${className ? ` ${className}` : ''}`}
      style={{ position: 'absolute', top }}
      ref={(node) => {
        // Its height feeds the same stacking run, so a card below the compose box moves down
        // to make room for it rather than being covered by it.
        measure(node, COMPOSE_KEY);
      }}
    >
      <div className="docx-review__card" data-testid="review-draft" data-draft="">
        <form
          className="docx-review__reply-box"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <label className="ep-sr-only" htmlFor={fieldId}>
            {t('comments.addComment')}
          </label>
          <input
            id={fieldId}
            ref={fieldRef}
            data-testid="review-draft-input"
            className="docx-review__input"
            value={text}
            placeholder={t('comments.addComment')}
            {...(refused ? { 'aria-invalid': true } : {})}
            onChange={(event) => {
              setRefused(false);
              setText(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                endDraft();
                return;
              }
              if (event.key !== 'Enter') return;
              event.preventDefault();
              submit();
            }}
          />
          <div className="docx-review__reply-actions">
            <button
              type="button"
              data-testid="review-draft-cancel"
              className="docx-review__text-button"
              onMouseDown={guardMousedown}
              onClick={endDraft}
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              data-testid="review-draft-submit"
              className="docx-review__submit"
              disabled={text.trim().length === 0}
            >
              {t('common.comment')}
            </button>
          </div>
          {refused ? (
            <span className="docx-review__refused" role="alert">
              {t('review.commentRefused')}
            </span>
          ) : null}
        </form>
      </div>
    </div>
  );
}
ReviewDraft.docxReviewPart = 'Draft' as const;

/** What a clicked tracked change tells us before any item matching — straight off its DOM. */
interface BalloonAnchor {
  readonly revisionId: string;
  readonly author: string;
  readonly date?: string;
  readonly kind?: string;
  /** True when the pressed element is a tracked table ROW — a structural site. */
  readonly structuralSite: boolean;
  /** The pressed span's own range, for the position rung of the match. */
  readonly paragraphId?: string;
  readonly start?: number;
  readonly end?: number;
  /** Rail-relative CSS px of the pressed element's box. */
  readonly left: number;
  readonly top: number;
  readonly bottom: number;
  /** True when the balloon opens upward — the target sits low in the window. */
  readonly above: boolean;
}

/**
 * The decision balloon: CLICKING a format or structural change in the PAGE opens its card
 * beside the text — author, what changed, when, and accept/reject where the engine can
 * resolve it — and the card stays until a press lands somewhere that is neither a tracked
 * change nor the balloon itself. Click-opened on purpose: a hover-opened card vanished
 * under the pointer travelling toward its own buttons.
 *
 * ONLY the kinds whose rail cards are hidden by default. Content changes and comments are
 * the rail's — a balloon over "added" text repeats a card already beside the page — while
 * a format or structural change has nothing but its grey/washed marking, so the click on
 * that marking is where its decision lives.
 *
 * Matches the pressed element against the UNFILTERED queue, attribution first and POSITION
 * last: the `(id, author, date)` triple, then `(id, author)`, then the id, then the span's
 * own paragraph range against the items' ranges — real files drift on attribution, and the
 * range is the one thing the painter and the review model cannot disagree about. An
 * element matching nothing still shows what its DOM carries, just without actions.
 *
 * @public
 */
function ReviewBalloon({ className, hidden }: ReviewPartProps) {
  const { review, allItems, authorSlots } = useRail();
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [anchor, setAnchor] = useState<BalloonAnchor | null>(null);
  // Whether a balloon is up, readable from the listener without re-binding it.
  const openRef = useRef(false);
  openRef.current = anchor !== null;

  useEffect(() => {
    const host = rootRef.current;
    const rail = host?.closest('.docx-review') as HTMLElement | null;
    // The engine's own scroll-container class first: `offsetParent` needs layout, which a
    // DOM without a renderer (happy-dom) does not do, and the viewport always carries it.
    const scroller = (rail?.closest('.docx-editor__scroll-container') ??
      rail?.offsetParent) as HTMLElement | null;
    if (!host || !rail || !scroller) return undefined;

    const open = (element: HTMLElement, structuralSite: boolean): void => {
      const railRect = rail.getBoundingClientRect();
      const rect = element.getBoundingClientRect();
      const viewportBottom = element.ownerDocument.defaultView?.innerHeight ?? Infinity;
      const start = Number(element.dataset.start);
      const end = Number(element.dataset.end);
      setAnchor({
        revisionId: element.dataset.revisionId!,
        author: element.dataset.revisionAuthor ?? '',
        ...(element.dataset.revisionDate !== undefined
          ? { date: element.dataset.revisionDate }
          : {}),
        ...(element.dataset.revisionKind !== undefined
          ? { kind: element.dataset.revisionKind }
          : {}),
        structuralSite,
        ...(element.dataset.paragraphId !== undefined
          ? { paragraphId: element.dataset.paragraphId }
          : {}),
        ...(Number.isFinite(start) ? { start } : {}),
        ...(Number.isFinite(end) ? { end } : {}),
        left: rect.left - railRect.left,
        top: rect.top - railRect.top,
        bottom: rect.bottom - railRect.top,
        // Opens upward when there is no room below — a change on the last visible line
        // would otherwise push its balloon under the fold.
        above: rect.bottom + 220 > viewportBottom,
      });
    };

    // Capture-phase press listeners; nothing runs at pointer-movement frequency.
    // Observation only: the press still moves the caret exactly as it did before the
    // balloon existed. A press anywhere that is not a qualifying change closes the card —
    // including on an insertion or deletion, whose decision lives in the rail.
    const onDown = (event: Event): void => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      // Pressing the balloon itself (accept, reject) is not a dismissal.
      if (host.contains(target)) return;
      const element = target.closest('[data-revision-id]');
      if (element instanceof HTMLElement && scroller.contains(element)) {
        const structuralSite = element.classList.contains('docx-table-row--revision');
        if (element.dataset.revisionKind === 'format' || structuralSite) {
          open(element, structuralSite);
          return;
        }
      }
      if (openRef.current) setAnchor(null);
    };
    // BOTH press events, not mousedown alone. The surface cancels `pointerdown` when it
    // places the caret, and a cancelled pointerdown SUPPRESSES the compatibility mousedown
    // outright — a mousedown-only listener never heard a real click on the page, only
    // synthetic ones, which is exactly how that bug shipped. The rare double delivery
    // (chrome areas cancel nothing) re-runs a handler that converges on the same state.
    scroller.addEventListener('pointerdown', onDown, true);
    scroller.addEventListener('mousedown', onDown, true);
    return () => {
      scroller.removeEventListener('pointerdown', onDown, true);
      scroller.removeEventListener('mousedown', onDown, true);
    };
  }, []);

  // The decision the pressed SITE belongs to. Sites coalesce into decisions by the
  // `(id, author, date)` triple, which is what the painted element carries — but real
  // files drift: producers reuse ids, omit dates on one wrapper and not another, and a
  // strict triple left the balloon informational over changes the rail could resolve. So
  // the match RELAXES in steps, taking the strictest interpretation with a single answer:
  // the full triple, then `(id, author)`, then the id alone — and never a guess between
  // two candidates.
  // ONE allocation-free pass, not one filter per rung: this re-derives on every review
  // tick while a balloon is up, and the queue behind a heavy redline runs to thousands.
  // The exact triple returns the FIRST hit immediately (Word reuses ids across an editing
  // burst, and reading order picks the right one); the relaxed rungs each keep a single
  // candidate and disqualify themselves on a second distinct hit. The POSITION rung runs
  // over the same pass: the pressed span's own paragraph range against the item's ranges,
  // restricted to the balloon's kinds — attribution can drift between the painter's read
  // and the review model's, but both took the range from the same characters.
  const entry = useMemo(() => {
    if (!anchor) return null;
    let byAuthor: ReviewItemView | null = null;
    let byAuthorAmbiguous = false;
    let byId: ReviewItemView | null = null;
    let byIdAmbiguous = false;
    let byRange: ReviewItemView | null = null;
    let byRangeAmbiguous = false;
    for (const candidate of allItems) {
      if (candidate.kind !== 'revision' || candidate.item.kind !== 'revision') continue;
      for (const address of candidate.item.addresses) {
        if (address.id !== anchor.revisionId) continue;
        if (address.author === anchor.author) {
          if (address.date === anchor.date) return candidate;
          if (byAuthor === null) byAuthor = candidate;
          else if (byAuthor !== candidate) byAuthorAmbiguous = true;
        }
        if (byId === null) byId = candidate;
        else if (byId !== candidate) byIdAmbiguous = true;
      }
      if (
        anchor.paragraphId !== undefined &&
        anchor.start !== undefined &&
        anchor.end !== undefined &&
        (candidate.revisionKind === 'format' || candidate.revisionKind === 'structural')
      ) {
        for (const range of candidate.item.ranges) {
          if (
            range.start.paragraphId === anchor.paragraphId &&
            range.start.offset < anchor.end &&
            range.end.offset > anchor.start
          ) {
            if (byRange === null) byRange = candidate;
            else if (byRange !== candidate) byRangeAmbiguous = true;
            break;
          }
        }
      }
    }
    if (byAuthor !== null && !byAuthorAmbiguous) return byAuthor;
    if (byId !== null && !byIdAmbiguous) return byId;
    if (byRange !== null && !byRangeAmbiguous) return byRange;
    return null;
  }, [allItems, anchor]);

  // The balloon serves the kinds the rail does not; a drifted id that happened to land on
  // a CONTENT decision must not raise a balloon over text whose card is beside the page.
  const served =
    entry && (entry.revisionKind === 'format' || entry.revisionKind === 'structural')
      ? entry
      : null;

  // Resolving the decision removes it from the queue; the balloon it was resolved from
  // must not linger over the text the accept just changed.
  const hadEntry = useRef(false);
  useEffect(() => {
    if (served) {
      hadEntry.current = true;
      return;
    }
    if (hadEntry.current) {
      hadEntry.current = false;
      setAnchor(null);
    }
  }, [served]);

  if (hidden) return null;
  const fallbackKind = anchor?.kind === 'format' ? ('format' as const) : ('structural' as const);

  return (
    // The wrapper always mounts — it is what the wiring effect climbs from — and carries
    // no box of its own until there is a balloon to show.
    <div ref={rootRef} className={`docx-review__balloon-root${className ? ` ${className}` : ''}`}>
      {anchor === null ? null : (
        <div
          className="docx-review__balloon"
          data-testid="review-balloon"
          style={{
            left: anchor.left,
            top: anchor.above ? anchor.top - 6 : anchor.bottom + 6,
            transform: anchor.above ? 'translateY(-100%)' : undefined,
          }}
          onMouseDown={guardMousedown}
        >
          {served ? (
            <ReviewItemContext.Provider value={served}>
              <div
                className="docx-review__card"
                data-testid="review-balloon-card"
                data-kind={served.revisionKind ?? 'revision'}
                style={
                  {
                    '--doc-review-author': `var(--doc-review-author-${(authorSlots.get(served.author) ?? 0) % AUTHOR_SLOTS})`,
                  } as CSSProperties
                }
                onClick={() => review.setActive(served.key)}
              >
                <div className="docx-review__head">
                  <ReviewAvatar />
                  <div className="docx-review__meta">
                    <ReviewAuthor />
                    <ReviewTime />
                  </div>
                  {served.kind === 'revision' && !served.readOnly ? (
                    <div className="docx-review__actions">
                      <ReviewAccept />
                      <ReviewReject />
                    </div>
                  ) : null}
                </div>
                <ReviewSummary />
              </div>
            </ReviewItemContext.Provider>
          ) : (
            <div
              className="docx-review__card"
              data-testid="review-balloon-card"
              data-kind={fallbackKind}
            >
              <div className="docx-review__head">
                <span className="docx-review__avatar" aria-hidden="true">
                  {initialsOf(anchor.author)}
                </span>
                <div className="docx-review__meta">
                  <span className="docx-review__author">
                    {anchor.author || t('comments.unknown')}
                  </span>
                  {anchor.date ? <BalloonTime raw={anchor.date} /> : null}
                </div>
              </div>
              <div className="docx-review__summary">
                <span className="docx-review__label" data-kind={fallbackKind}>
                  {t(revisionLabelKey(fallbackKind))}
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
ReviewBalloon.docxReviewPart = 'Balloon' as const;

/** Initials for the dataset-only fallback, matching the engine's own derivation. */
function initialsOf(author: string): string {
  const words = author.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  return words
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join('');
}

/** `ReviewTime` for a raw dataset date, outside any item context. */
function BalloonTime({ raw }: { raw: string }) {
  const when = new Date(raw);
  if (Number.isNaN(when.getTime())) return null;
  return (
    <time className="docx-review__time" dateTime={raw}>
      {REVIEW_DATE_FORMAT.format(when)}
    </time>
  );
}

/** Shown when nothing is pending. @public */
function ReviewEmpty({ className, hidden, children }: ReviewPartProps) {
  const { t } = useTranslation();
  if (hidden) return null;
  return (
    <div
      className={`docx-review__empty${className ? ` ${className}` : ''}`}
      data-testid="review-empty"
    >
      {children ?? t('review.empty')}
    </div>
  );
}
ReviewEmpty.docxReviewPart = 'Empty' as const;

/**
 * One card.
 *
 * Clicking it makes the item active, which SELECTS ITS RANGE in the document — the card and
 * the text it is about are two views of one thing, and a card that highlighted nothing left
 * the reader hunting for which words a comment meant.
 *
 * @public
 */
function ReviewCard({ className, asChild, hidden, children }: ReviewPartProps) {
  const { review, authorSlots } = useRail();
  const entry = useContext(ReviewItemContext);
  const cardId = useId();
  if (hidden || !entry) return null;
  const slot = authorSlots.get(entry.author) ?? 0;

  const shared = {
    className: `docx-review__card${className ? ` ${className}` : ''}`,
    'data-testid': 'review-card',
    'aria-labelledby': `${cardId}-author ${cardId}-summary`,
    'data-kind': entry.kind === 'revision' ? (entry.revisionKind ?? 'revision') : entry.kind,
    ...(entry.isActive ? { 'data-active': '' } : {}),
    ...(entry.kind === 'comment' && entry.resolved ? { 'data-resolved': '' } : {}),
    // The author colour is a CSS variable rather than a class, so a host restyling the card
    // keeps the per-author identity without re-deriving the slot order.
    style: {
      '--doc-review-author': `var(--doc-review-author-${slot % AUTHOR_SLOTS})`,
    } as CSSProperties,
    tabIndex: 0,
    // `button`, not `group`: it has one action and assistive tech has to announce it. A
    // `group` with no accessible name is commonly dropped from the tree entirely.
    role: 'button' as const,
    id: cardId,
    // The rail's mousedown guard keeps the caret, which also cancelled focus and made the
    // card's own text unselectable. Taking focus explicitly restores the keyboard path
    // without giving the caret away.
    onMouseDown: (event: React.MouseEvent) => {
      if ((event.target as HTMLElement | null)?.closest('[data-review-selectable]')) return;
      (event.currentTarget as HTMLElement).focus({ preventScroll: true });
    },
    onClick: () => review.setActive(entry.key),
    onKeyDown: (event: React.KeyboardEvent) => {
      // Only the CARD's own keys. The reply box is inside it, and a bubbling handler that
      // treats Space as "activate" swallows every space someone types — a reply came out as
      // "Agreed,keepingthis." before this guard.
      if (event.target !== event.currentTarget) return;
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      review.setActive(entry.key);
    },
  };

  if (asChild) return <Slot {...shared}>{children}</Slot>;
  return (
    <div {...shared}>
      <ReviewCardPreset>{children}</ReviewCardPreset>
    </div>
  );
}
ReviewCard.docxReviewPart = 'Card' as const;

/**
 * The packaged card, with in-place part override.
 *
 * A part passed as a child REPLACES the preset's copy of it rather than appending to it, so
 * `<Review.Reply hidden />` removes the reply box instead of adding a second hidden one.
 */
function ReviewCardPreset({ children }: { children?: ReactNode }) {
  const entry = useContext(ReviewItemContext);
  const overrides = useMemo(() => partOverrides(children), [children]);
  const take = (key: string, fallback: ReactNode): ReactNode =>
    key in overrides ? overrides[key] : fallback;
  if (!entry) return null;

  // A custom-node card is the definition's own: its `reviewCard` hook titled it, and it
  // has no author, no thread and nothing to resolve. Every string renders as TEXT — the
  // attrs and label originate in the file.
  if (entry.kind === 'custom' && entry.item.kind === 'custom') {
    const item = entry.item;
    return (
      <>
        <div className="docx-review__head">
          <div className="docx-review__meta">
            <span className="docx-review__author" data-testid="review-custom-title">
              {item.title}
            </span>
          </div>
        </div>
        {item.detail ? (
          <div
            className="docx-review__summary"
            data-testid="review-summary"
            data-review-selectable=""
          >
            <span className="docx-review__text">{item.detail}</span>
          </div>
        ) : null}
        {overrides.__extra}
      </>
    );
  }
  const resolvable = entry.kind === 'revision' && !entry.readOnly;

  return (
    <>
      <div className="docx-review__head">
        {take('Avatar', <ReviewAvatar />)}
        <div className="docx-review__meta">
          {take('Author', <ReviewAuthor />)}
          {take('Time', <ReviewTime />)}
        </div>
        {/* Accept and Reject are absent, not disabled, on a kind the engine cannot resolve:
            a button that can never do anything is chrome pretending to be a capability.
            Delete follows the same rule and is on BOTH kinds, so every card a reader can
            act on carries a way to be rid of it. */}
        {resolvable || entry.kind === 'comment' ? (
          <div className="docx-review__actions">
            {take('Accept', <ReviewAccept />)}
            {take('Reject', <ReviewReject />)}
            {take('Delete', <ReviewDelete />)}
          </div>
        ) : null}
      </div>
      {take('Summary', <ReviewSummary />)}
      {take('Replies', <ReviewReplies />)}
      {take('Reply', <ReviewReply />)}
      {overrides.__extra}
    </>
  );
}

/** Map a child's part marker to itself, so the preset can swap it in place. */
function partOverrides(children: ReactNode): Record<string, ReactNode> {
  const found: Record<string, ReactNode> = {};
  const extra: ReactNode[] = [];
  const visit = (node: ReactNode): void => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!node || typeof node !== 'object' || !('type' in node)) {
      if (node) extra.push(node);
      return;
    }
    // A FRAGMENT is grouping, not content: `<><Accept/><Reject/></>` is the natural way to
    // pass two overrides, and treating it as an unrecognised child would render both inside
    // the card while the preset still drew its own copies of each.
    if (node.type === Fragment) {
      visit((node.props as { children?: ReactNode }).children);
      return;
    }
    const marker = (node.type as { docxReviewPart?: string }).docxReviewPart;
    if (marker) found[marker] = node;
    else extra.push(node);
  };
  visit(children);
  if (extra.length > 0) found.__extra = extra;
  return found;
}

/** The author's initials, in their colour. @public */
function ReviewAvatar({ className, asChild, hidden, children }: ReviewPartProps) {
  const entry = useContext(ReviewItemContext);
  if (hidden || !entry) return null;
  const shared = {
    className: `docx-review__avatar${className ? ` ${className}` : ''}`,
    'data-testid': 'review-avatar',
    'aria-hidden': true,
  };
  if (asChild) return <Slot {...shared}>{children}</Slot>;
  return <span {...shared}>{children ?? entry.initials}</span>;
}
ReviewAvatar.docxReviewPart = 'Avatar' as const;

/** The author's name. @public */
function ReviewAuthor({ className, asChild, hidden, children }: ReviewPartProps) {
  const entry = useContext(ReviewItemContext);
  const { t } = useTranslation();
  if (hidden || !entry) return null;
  const author = entry.author || t('comments.unknown');
  const shared = {
    className: `docx-review__author${className ? ` ${className}` : ''}`,
    'data-testid': 'review-author',
  };
  if (asChild) return <Slot {...shared}>{children}</Slot>;
  return <span {...shared}>{children ?? author}</span>;
}
ReviewAuthor.docxReviewPart = 'Author' as const;

/**
 * When the change was made.
 *
 * `@w:date` is optional in `CT_TrackChange` and Word omits it when the author turned off
 * "store randomized IDs"/date stamping, so a missing date renders nothing rather than an
 * "Invalid Date".
 *
 * @public
 */
function ReviewTime({ className, asChild, hidden, children }: ReviewPartProps) {
  const entry = useContext(ReviewItemContext);
  if (hidden || !entry) return null;
  const raw = entry.date;
  if (!raw) return null;
  const when = new Date(raw);
  if (Number.isNaN(when.getTime())) return null;
  // No `title`: the visible text already carries the date and time, and the native tooltip
  // popped over the author's name in the balloon, reading as a mystery grey box.
  const shared = {
    className: `docx-review__time${className ? ` ${className}` : ''}`,
    'data-testid': 'review-time',
    dateTime: raw,
  };
  if (asChild) return <Slot {...shared}>{children}</Slot>;
  // Month, day and time — what Word shows, and what a reviewer actually needs: two comments
  // on the same day are ordered by the clock, which a bare date hides.
  return <time {...shared}>{children ?? REVIEW_DATE_FORMAT.format(when)}</time>;
}
ReviewTime.docxReviewPart = 'Time' as const;

/** Locale-aware, so a translated rail is not left with an English date. */
const REVIEW_DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

/**
 * What the card is about: the comment's text, or what the revision did.
 *
 * A revision that carries no characters — a formatting change, a paragraph mark, a row
 * insertion — still gets a sentence. Word shows one, and a card reading only "Ada Lovelace"
 * tells the reviewer nothing they can decide on.
 *
 * @public
 */
function ReviewSummary({ className, asChild, hidden, children }: ReviewPartProps) {
  const entry = useContext(ReviewItemContext);
  const { t } = useTranslation();
  if (hidden || !entry) return null;
  const text = entry.text;
  const label = entry.kind !== 'revision' ? null : t(revisionLabelKey(entry.revisionKind));
  // A replacement reads as one sentence, not as a label over a quote: what went, and what
  // took its place. Both quoted, both in their own colour, the way Word words it.
  const replaced = entry.kind === 'revision' && entry.revisionKind === 'replace';
  const shared = {
    className: `docx-review__summary${className ? ` ${className}` : ''}`,
    'data-testid': 'review-summary',
    'data-review-selectable': '',
  };
  if (asChild) return <Slot {...shared}>{children}</Slot>;
  return (
    <div {...shared}>
      {children ??
        (replaced ? (
          <span className="docx-review__text">
            {t('review.replaced')}{' '}
            <span className="docx-review__removed">&quot;{entry.replacedText}&quot;</span>{' '}
            {t('review.replacedWith')}{' '}
            <span className="docx-review__added">&quot;{text}&quot;</span>
          </span>
        ) : (
          <>
            {/* `data-kind` carries the colour: an "Added" label in the green the insertion
                already wears reads as one statement with the document, where a grey label
                over green text reads as two. */}
            {label ? (
              <span
                className="docx-review__label"
                data-kind={entry.kind === 'revision' ? entry.revisionKind : 'revision'}
              >
                {label}
              </span>
            ) : null}
            {/* The quoted text is the DOCUMENT's, so it is rendered as text and never as
                markup: a `.docx` is a zip of XML an attacker controls end to end. */}
            {text ? <span className="docx-review__text">{text}</span> : null}
          </>
        ))}
    </div>
  );
}
ReviewSummary.docxReviewPart = 'Summary' as const;

function revisionLabelKey(kind: ReviewRevisionKind): TranslationKey {
  switch (kind) {
    case 'insert':
      return 'review.inserted';
    case 'delete':
      return 'review.deleted';
    case 'replace':
      return 'review.replaced';
    case 'moveFrom':
      return 'review.movedFrom';
    case 'moveTo':
      return 'review.movedTo';
    case 'format':
      return 'revisions.runPropertiesChanged';
    case 'paragraphMark':
      return 'revisions.paragraphMarkInserted';
    default:
      return 'review.structural';
  }
}

/** Accept the revision behind this card. @public */
function ReviewAccept({ className, asChild, hidden, children, icon: glyph }: ReviewActionProps) {
  const { review } = useRail();
  const entry = useContext(ReviewItemContext);
  const { t } = useTranslation();
  if (hidden || !entry || entry.kind !== 'revision' || entry.readOnly) return null;
  const label = t('review.accept');
  const shared = {
    type: 'button' as const,
    className: `docx-review__action${className ? ` ${className}` : ''}`,
    'data-testid': 'review-accept',
    'aria-label': label,
    title: label,
    onMouseDown: guardMousedown,
    onClick: (event: React.MouseEvent) => {
      event.stopPropagation();
      review.accept(entry);
    },
  };
  if (asChild) return <Slot {...shared}>{children}</Slot>;
  return <button {...shared}>{glyph ?? children ?? icon(ACCEPT_ICON)}</button>;
}
ReviewAccept.docxReviewPart = 'Accept' as const;

/** Reject the revision behind this card. @public */
function ReviewReject({ className, asChild, hidden, children, icon: glyph }: ReviewActionProps) {
  const { review } = useRail();
  const entry = useContext(ReviewItemContext);
  const { t } = useTranslation();
  if (hidden || !entry || entry.kind !== 'revision' || entry.readOnly) return null;
  const label = t('review.reject');
  const shared = {
    type: 'button' as const,
    className: `docx-review__action${className ? ` ${className}` : ''}`,
    'data-testid': 'review-reject',
    'aria-label': label,
    title: label,
    onMouseDown: guardMousedown,
    onClick: (event: React.MouseEvent) => {
      event.stopPropagation();
      review.reject(entry);
    },
  };
  if (asChild) return <Slot {...shared}>{children}</Slot>;
  return <button {...shared}>{glyph ?? children ?? icon(REJECT_ICON)}</button>;
}
ReviewReject.docxReviewPart = 'Reject' as const;

/**
 * Discard what the card holds: delete a comment thread, or reject a tracked change.
 *
 * The rail had accept and reject for a change and NOTHING for a comment, so a remark could be
 * resolved but never removed — a reader who commented by mistake had to go back to the text and
 * delete the words to be rid of it. One control on both kinds, because "remove this" is the same
 * intent whichever the card holds; the engine's `deleteReviewItem` decides what it means.
 *
 * Absent, not disabled, on a card with nothing to discard — a custom node's, or a revision kind
 * the engine cannot resolve.
 *
 * @public
 */
function ReviewDelete({ className, asChild, hidden, children, icon: glyph }: ReviewActionProps) {
  const { review } = useRail();
  const entry = useContext(ReviewItemContext);
  const { t } = useTranslation();
  if (hidden || !entry || entry.kind === 'custom') return null;
  if (entry.kind === 'revision' && entry.readOnly) return null;
  const label = entry.kind === 'comment' ? t('review.deleteComment') : t('review.discardChange');
  const shared = {
    type: 'button' as const,
    className: `docx-review__action${className ? ` ${className}` : ''}`,
    'data-testid': 'review-delete',
    'aria-label': label,
    title: label,
    onMouseDown: guardMousedown,
    onClick: (event: React.MouseEvent) => {
      // The card is a `role="button"` that activates the item; without this the click both
      // deleted the comment and asked the engine to open a card that no longer exists.
      event.stopPropagation();
      review.remove(entry);
    },
  };
  if (asChild) return <Slot {...shared}>{children}</Slot>;
  return <button {...shared}>{glyph ?? children ?? icon(DELETE_ICON)}</button>;
}
ReviewDelete.docxReviewPart = 'Delete' as const;

/** The thread under a comment, in document order. @public */
function ReviewReplies({ className, hidden }: ReviewPartProps) {
  const { byId } = useRail();
  const entry = useContext(ReviewItemContext);
  // Comments AND revisions. A reply to a tracked change is a comment over that change's range,
  // and refusing to draw it here is what put the reader's answer in a card of its own, floating
  // beside the change instead of under it.
  if (hidden || !entry || entry.kind === 'custom') return null;
  const replies = entry.replyIds
    .map((id) => byId.get(id))
    .filter((reply): reply is ReviewItemView => reply !== undefined);
  if (replies.length === 0) return null;
  return (
    <ol className={`docx-review__replies${className ? ` ${className}` : ''}`}>
      {replies.map((reply) => (
        <ReviewItemContext.Provider key={reply.key} value={reply}>
          <li className="docx-review__reply" data-testid="review-reply">
            <div className="docx-review__head">
              <ReviewAvatar />
              <div className="docx-review__meta">
                <ReviewAuthor />
                <ReviewTime />
              </div>
            </div>
            <ReviewSummary />
          </li>
        </ReviewItemContext.Provider>
      ))}
    </ol>
  );
}
ReviewReplies.docxReviewPart = 'Replies' as const;

/**
 * The reply box.
 *
 * Open only on the ACTIVE card: a rail with a text field on every card is mostly text fields,
 * and the caret landing in a tracked change is what says which conversation the reader is in.
 *
 * Replying to a revision writes a comment over that revision's range — `w:ins` and `w:del`
 * have no body and no thread in OOXML, so there is nowhere else for the text to live.
 *
 * @public
 */
function ReviewReply({ className, hidden, children }: ReviewPartProps) {
  const { review } = useRail();
  const entry = useContext(ReviewItemContext);
  const { t } = useTranslation();
  const [draft, setDraft] = useState('');
  const [refused, setRefused] = useState(false);
  const fieldId = useId();

  const submit = useCallback(() => {
    if (!entry || draft.trim().length === 0) return;
    // The author is AMBIENT (`EditorConfig.author`); the engine refuses rather than writing
    // `w:author=""`, which `CT_Comment` does not allow. The draft is KEPT on a refusal —
    // clearing it would throw away what someone just wrote and show nothing in its place.
    const landed = review.reply(entry, draft.trim());
    setRefused(!landed);
    if (landed) setDraft('');
  }, [entry, draft, review]);

  if (hidden || !entry || !entry.isActive) return null;
  if (children) return <>{children}</>;

  return (
    <form
      className={`docx-review__reply-box${className ? ` ${className}` : ''}`}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <label className="ep-sr-only" htmlFor={fieldId}>
        {t('comments.replyPlaceholder')}
      </label>
      <input
        id={fieldId}
        data-testid="review-reply-input"
        className="docx-review__input"
        value={draft}
        placeholder={t('comments.replyPlaceholder')}
        {...(refused ? { 'aria-invalid': true, 'data-refused': '' } : {})}
        onChange={(event) => {
          setRefused(false);
          setDraft(event.target.value);
        }}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          submit();
        }}
      />
      <div className="docx-review__reply-actions">
        <button
          type="button"
          data-testid="review-reply-cancel"
          className="docx-review__text-button"
          onMouseDown={guardMousedown}
          onClick={(event) => {
            event.stopPropagation();
            setDraft('');
            setRefused(false);
            review.setActive(null);
          }}
        >
          {t('common.cancel')}
        </button>
        <button
          type="submit"
          data-testid="review-reply-submit"
          className="docx-review__submit"
          disabled={draft.trim().length === 0}
        >
          {t('review.reply')}
        </button>
      </div>
      {refused ? (
        <span className="docx-review__refused" role="alert" data-testid="review-reply-refused">
          {t('review.replyRefused')}
        </span>
      ) : null}
    </form>
  );
}
ReviewReply.docxReviewPart = 'Reply' as const;

/**
 * The review rail compound.
 *
 * @public
 */
export interface DocxEditorReviewNamespace {
  (props: ReviewProps): ReturnType<typeof ReviewRoot>;
  readonly List: typeof ReviewList;
  readonly Empty: typeof ReviewEmpty;
  readonly Card: typeof ReviewCard;
  readonly Avatar: typeof ReviewAvatar;
  readonly Author: typeof ReviewAuthor;
  readonly Time: typeof ReviewTime;
  readonly Summary: typeof ReviewSummary;
  readonly Accept: typeof ReviewAccept;
  readonly Reject: typeof ReviewReject;
  /** Discard the card: delete a comment thread, or reject a tracked change. */
  readonly Delete: typeof ReviewDelete;
  readonly Replies: typeof ReviewReplies;
  readonly Reply: typeof ReviewReply;
  /** The collapsed rail: one marker per item, shown when the pane is closed. */
  readonly Markers: typeof ReviewMarkers;
  /** The "comment on this" button beside a selected range. */
  readonly AddComment: typeof ReviewAddComment;
  /** The compose box a new comment is written in. */
  readonly Draft: typeof ReviewDraft;
  /** The decision balloon opened by clicking a format or structural change in the page. */
  readonly Balloon: typeof ReviewBalloon;
}

export const DocxEditorReview: DocxEditorReviewNamespace = Object.assign(ReviewRoot, {
  List: ReviewList,
  Empty: ReviewEmpty,
  Card: ReviewCard,
  Avatar: ReviewAvatar,
  Author: ReviewAuthor,
  Time: ReviewTime,
  Summary: ReviewSummary,
  Accept: ReviewAccept,
  Reject: ReviewReject,
  Delete: ReviewDelete,
  Replies: ReviewReplies,
  Reply: ReviewReply,
  Markers: ReviewMarkers,
  AddComment: ReviewAddComment,
  Draft: ReviewDraft,
  Balloon: ReviewBalloon,
});

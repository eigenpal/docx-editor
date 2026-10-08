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
  cloneElement,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { ReactNode } from 'react';
import type { ReviewRevisionKind, SelectionPin } from '@docx-editor.dev/core/contracts/editor';
import type { TranslationKey } from '@docx-editor.dev/i18n';
import {
  REVIEW_PANE_GUTTER,
  ReviewRailContext,
  Slot,
  useDocxEditor,
  useEditorEvent,
  useEditorState,
  useReviewAuthors,
  useReviewGutter,
  useTranslation,
} from '@docx-editor.dev/react';
import { cloneReviewCard, listCardTemplate, partitionReviewChildren } from './review-composition';
import {
  COMPACT_CARD_WIDTH,
  RAIL_OVERSCAN,
  useRailMetrics,
  useRailWindow,
} from './use-rail-geometry';
import { useReviewSlotSizing } from './use-review-slot-sizing';
import { useReview, type ReviewItemView } from './useReview';
import { useReviewAuthorInfo } from './review-author-styles';
import { ResolvedDisclosureProvider } from './review-comment-resolution.tsx';
import { hasFormattingBalloon } from './review-balloon-anchor.ts';
import type { ReviewProps } from './review-types.ts';
import { ReviewContext, ReviewItemContext, type ReviewRailValue } from './review-context.ts';
import {
  COLLAPSED_CARD_HEIGHT,
  COLLAPSE_DISPLACEMENT_PX,
  COMPOSE_KEY,
  DEFAULT_CARD_HEIGHT,
  NO_PLACEMENT_REVIEW_QUERY,
  PAIRED_REVIEW_QUERY,
  guardMousedown,
  idsOf,
  isThreadedReply,
  selectCommentMarkers,
  selectDocumentAbsent,
  selectDocumentReadOnly,
  selectPaneOpening,
  selectRevisionsIn,
  servedByChangeBalloon,
} from './review-shared.ts';
import {
  ReviewAccept,
  ReviewAuthor,
  ReviewAvatar,
  ReviewCard,
  ReviewDelete,
  ReviewDraft,
  ReviewEmpty,
  ReviewReject,
  ReviewReopen,
  ReviewReplies,
  ReviewReply,
  ReviewResolve,
  ReviewSummary,
  ReviewTime,
} from './review-card-parts.tsx';
import {
  ReviewAddComment,
  ReviewBalloon,
  ReviewList,
  ReviewMarkers,
} from './review-rail-parts.tsx';

export { useReviewAuthor, useReviewItem } from './review-context.ts';
export type {
  ReviewActionProps,
  ReviewBalloonProps,
  ReviewMarkersProps,
  ReviewPartProps,
  ReviewProps,
} from './review-types.ts';

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
  t: hostT,
  card,
  preset = true,
  stack = true,
  gap = 8,
  filter,
  structural = true,
  formatting = false,
}: ReviewProps) {
  const editor = useDocxEditor();
  // While the editor holds no document, the rail renders NOTHING — not its empty state,
  // not the host's furniture. The instance exists before any bytes arrive, so without
  // this gate "no comments yet" and the furniture floated over the host's loading
  // screen, describing a document that was not there.
  const documentAbsent = useEditorState(selectDocumentAbsent);
  const readOnly = useEditorState(selectDocumentReadOnly);
  // Viewer preferences, live: `setRevisionMarkup` re-renders the rail with the new layout.
  const revisionsIn = useEditorState(selectRevisionsIn);
  const commentMarkers = useEditorState(selectCommentMarkers);
  const excludeRevisionKinds = useMemo((): readonly ReviewRevisionKind[] | undefined => {
    const excluded: ReviewRevisionKind[] = [];
    if (!structural) excluded.push('structural');
    if (!formatting) excluded.push('format');
    return excluded.length > 0 ? excluded : undefined;
  }, [structural, formatting]);

  const railQuery = useMemo(
    () => ({ excludeRevisionKinds: excludeRevisionKinds?.filter((kind) => kind !== 'format') }),
    [excludeRevisionKinds]
  );

  // Exclude caret activation for opt-out structural cards and balloon-only formatting.
  // Other formatting retains activation for its fallback sidebar card.
  // Clear on unmount so a rail-less host keeps unfiltered activation.
  useEffect(() => {
    editor?.setReviewActivationExclusions(excludeRevisionKinds ?? null, {
      formattingKinds: ['rPrChange', 'pPrChange'],
    });
    return () => editor?.setReviewActivationExclusions(null);
  }, [editor, excludeRevisionKinds]);

  // `revisionsIn: 'balloons'` reads replacement pairs so a typed-over range is one decision.
  const allReview = useReview(
    revisionsIn === 'balloons' ? PAIRED_REVIEW_QUERY : NO_PLACEMENT_REVIEW_QUERY
  );
  const review = useReview(railQuery);
  const setReviewPaneOpen = review.setPaneOpen;
  // The root provides the context `useReviewLabel` reads, so it resolves from the prop.
  const { t: bundled } = useTranslation();
  const t = useCallback((key: TranslationKey) => hostT?.(key) ?? bundled(key), [hostT, bundled]);
  const railRef = useRef<HTMLElement | null>(null);
  // Claim the gutter. Without this the viewport reserved it for every consumer, mounted
  // rail or not, and the tier-2 `<DocxEditor>` sugar mounts none.
  const railRegistry = useContext(ReviewRailContext);
  useEffect(() => railRegistry?.register(), [railRegistry]);
  // The pane's open state is the ENGINE's, not this component's: the toolbar toggles it and
  // the viewport shifts the page for it, so a flag kept here would be a third opinion.
  const open = review.paneOpen;
  // How much room the viewport actually reserved for that open pane. On a viewport too
  // narrow for the full column, `DocxEditor.Viewport` mirrors the marker strip onto both
  // edges instead — and a card drawn where the column would have been is cut off at the
  // viewport's edge. So the rail follows the reservation: COMPACT means the pane is open
  // but only the strip exists, and the rail presents markers with the one ACTIVE card
  // floating pinned inside the viewport instead of the full column of cards. `inlineEnd`
  // is 0 for one render while this rail's own registration is still in flight; that frame
  // keeps the expanded presentation rather than flashing markers.
  const gutter = useReviewGutter();
  const compact = open && gutter.inlineEnd > 0 && gutter.inlineEnd < REVIEW_PANE_GUTTER;
  const expanded = open && !compact;

  const items = useMemo(() => {
    return review.items.filter(
      (entry) =>
        (formatting || !hasFormattingBalloon(entry)) &&
        (revisionsIn !== 'balloons' || !servedByChangeBalloon(entry)) &&
        (!filter || filter(entry))
    );
  }, [review.items, filter, formatting, revisionsIn]);
  // A revealed card opens a closed pane, as a click on its marker does, unless the pane's
  // `opening` setting leaves that to the host. A change that the balloon serves is not in
  // `items`, so the balloon opens it instead.
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const paneOpening = useEditorState(selectPaneOpening);
  const paneOpeningRef = useRef(paneOpening);
  paneOpeningRef.current = paneOpening;
  useEditorEvent('reviewItemReveal', ({ key }) => {
    if (hidden || paneOpeningRef.current === 'manual') return;
    if (itemsRef.current.some((entry) => entry.key === key)) setReviewPaneOpen(true);
  });
  const configuredAuthor = useSyncExternalStore(
    useCallback((notify) => editor?.on('selectionChange', notify) ?? (() => {}), [editor]),
    () => editor?.getConfiguredAuthor() ?? null,
    () => null
  );
  const authorSlots = useMemo(() => {
    const slots = new Map<string, number>();
    for (const entry of items) {
      if (entry.author && !slots.has(entry.author)) slots.set(entry.author, slots.size);
    }
    if (configuredAuthor && !slots.has(configuredAuthor)) {
      slots.set(configuredAuthor, slots.size);
    }
    return slots;
  }, [items, configuredAuthor]);
  const byId = useMemo(() => {
    const map = new Map<string, ReviewItemView>();
    for (const entry of items) map.set(entry.id, entry);
    // The balloon draws a change's replies, which this rail no longer lists.
    if (revisionsIn === 'balloons') {
      for (const entry of allReview.items) if (!map.has(entry.id)) map.set(entry.id, entry);
    }
    return map;
  }, [items, revisionsIn, allReview.items]);

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
  const observeSlot = useReviewSlotSizing(measure);

  // Where the rail sits and which band of the scroller is on screen — the DOM-measurement
  // half of the rail, in `use-rail-geometry.ts`.
  const metrics = useRailMetrics(editor, railRef, items, !documentAbsent && !hidden, compact);
  const window_ = useRailWindow(editor, railRef, !documentAbsent && !hidden);

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
    // `documentAbsent` and `hidden` for the same reason as the metrics effect: no rail element
    // exists while either holds.
  }, [editor, documentAbsent, hidden]);

  // A comment being composed, before anything is written. Held here rather than committed
  // empty: an empty `w:comment` is a real comment in the file, and abandoning the box would
  // leave one behind for every time someone changed their mind.
  const [draftAnchorY, setDraftAnchorY] = useState<number | null>(null);
  const selectionPinRef = useRef<{
    editor: NonNullable<ReturnType<typeof useDocxEditor>>;
    pin: SelectionPin;
  } | null>(null);
  const releaseSelectionPin = useCallback(() => {
    const retained = selectionPinRef.current;
    if (!retained) return;
    retained.editor.releaseSelection(retained.pin);
    selectionPinRef.current = null;
  }, []);
  const beginDraft = useCallback(() => {
    if (!editor || readOnly) return;
    const anchorY = editor.getSelectionPlacement()?.anchorY ?? null;
    if (anchorY === null) return;
    // Pin the range before the compose box takes focus, or the browser drops the highlight
    // off the very words the comment is about.
    releaseSelectionPin();
    const pin = editor.retainSelection();
    if (!pin) return;
    selectionPinRef.current = { editor, pin };
    setReviewPaneOpen(true);
    setDraftAnchorY(anchorY);
  }, [editor, readOnly, releaseSelectionPin, setReviewPaneOpen]);
  useEffect(() => {
    // Not registered while READ-ONLY either: the registry's `requestCommentDraft` reports
    // whether anything served the request, and a handler that accepts and then refuses made
    // it answer yes to a draft that never opened.
    if (hidden || readOnly) return undefined;
    return railRegistry?.registerCommentDraft(beginDraft);
  }, [beginDraft, hidden, readOnly, railRegistry]);
  const endDraft = useCallback(() => {
    releaseSelectionPin();
    setDraftAnchorY(null);
    // Back to the document. Closing the box unmounts it, and without this the user landed on
    // `<body>` with Tab restarting at the top of the page.
    editor?.focus();
  }, [editor, releaseSelectionPin]);
  useEffect(() => releaseSelectionPin, [releaseSelectionPin]);
  useEffect(() => {
    if (open || draftAnchorY === null) return;
    // Closing the pane abandons its uncommitted draft. Release the pinned range without
    // moving focus away from the toolbar control that closed it.
    releaseSelectionPin();
    setDraftAnchorY(null);
  }, [open, draftAnchorY, releaseSelectionPin]);

  // The compose CARD stacks with the cards, because it is one: rendered outside the run it
  // landed on top of the card the caret had just been sent to, and its anchor IS that
  // card's anchor, so nothing about its own position could have avoided the collision. The
  // BUTTON does not stack — it sits against the page instead, where nothing else is.
  const composeAnchorY = draftAnchorY ?? review.selectionAnchorY;
  // Only what the list RENDERS competes for the column: a threaded reply lives inside its
  // parent's card, and letting it into the run advanced the cursor once per reply, spacing
  // every card below a commented conversation by gaps nothing on screen accounted for.
  const roots = useMemo(() => {
    const present = idsOf(items);
    return items.filter((entry) => !isThreadedReply(entry, present));
  }, [items]);
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
  // Compact takes the RAW anchor: the stacking run pushes the box below the estimated
  // heights of cards that, compact, render as small markers — phantom content, so a box
  // stacked below it floated far under the selection it is about.
  const composeTop =
    composeAnchorY === null
      ? null
      : metrics.top +
        (compact ? composeAnchorY : (stacked.get(COMPOSE_KEY) ?? composeAnchorY)) * metrics.scale;

  const cardClassName = card?.className;
  // The facade's resolved roster (reference-stable, live through `setRevisionStyles`),
  // keyed by author for the card parts.
  const roster = useReviewAuthors();
  const authorInfo = useReviewAuthorInfo(roster, items, authorSlots, editor);
  const draftAuthorSlot = configuredAuthor ? (authorSlots.get(configuredAuthor) ?? 0) : 0;
  const draftAuthorInfo = configuredAuthor ? authorInfo.get(configuredAuthor) : undefined;
  const value = useMemo<ReviewRailValue>(
    () => ({
      t: hostT,
      cardClassName,
      readOnly,
      review: { ...review, items },
      allItems: allReview.items,
      authorSlots,
      authorInfo,
      draftAuthor: configuredAuthor,
      draftAuthorInfo,
      draftAuthorSlot,
      byId,
      measure: observeSlot,
      beginDraft,
      endDraft,
      commentMarkers,
      revisionsIn,
    }),
    [
      hostT,
      cardClassName,
      readOnly,
      review,
      allReview.items,
      items,
      authorSlots,
      authorInfo,
      configuredAuthor,
      draftAuthorInfo,
      draftAuthorSlot,
      byId,
      observeSlot,
      beginDraft,
      endDraft,
      commentMarkers,
      revisionsIn,
    ]
  );

  if (hidden || documentAbsent) return null;

  const shared = {
    ref: railRef as React.Ref<HTMLElement>,
    className: `docx-review${className ? ` ${className}` : ''}`,
    'data-testid': 'review-rail',
    'data-count': items.length,
    // The COLUMN presentation, not the engine's pane state: compact keeps the strip
    // styling (`:not([data-open])` is the 32px gutter) while the pane itself stays open.
    'data-open': expanded ? '' : undefined,
    'data-compact': compact ? '' : undefined,
    role: 'region' as const,
    'aria-label': t('review.ariaLabel'),
    onMouseDown: guardMousedown,
    // `right: 0` from the stylesheet is the fallback for a host with no painted surface to
    // measure; once there is one, the rail is placed against its edge instead.
    style: metrics.left === null ? undefined : { left: metrics.left, right: 'auto' },
  };

  // Root parts and card parts are separate scopes. A root render prop remains the legacy
  // shorthand for the implicit List's render prop; node children that are not root parts become
  // that List's card template. Without this partition an AddComment sibling was also forwarded
  // into every Card, while a root render prop made it impossible to supply AddComment at all.
  const rootChildren: {
    parts: Record<string, ReactNode>;
    rest: ReactNode | ((item: ReviewItemView) => ReactNode);
  } =
    typeof children === 'function'
      ? { parts: {}, rest: children }
      : partitionReviewChildren(children, 'root');
  const rootParts = rootChildren.parts;
  // An override REPLACES the packaged element but inherits its wiring: these parts are handed
  // geometry the rail alone can compute — the markers' `scale`/`offset`/`window`, the compose
  // box's `top` — and a host writing `<Review.Markers icon={…}/>` cannot supply any of it.
  // Taken verbatim, such a child mounted a markers layer with `scale: 1` and no window, which
  // stacked every marker at the top of the gutter. Host props still win, so an override that
  // DOES pass one of them keeps it.
  const takeRoot = (key: string, fallback: ReactNode): ReactNode => {
    if (!(key in rootParts)) return fallback;
    const override = rootParts[key];
    if (!isValidElement(override) || !isValidElement(fallback)) return override;
    return cloneElement(override, {
      ...(fallback.props as Record<string, unknown>),
      ...(override.props as Record<string, unknown>),
    });
  };

  const affordances = (
    <>
      {preset || 'AddComment' in rootParts
        ? takeRoot(
            'AddComment',
            <ReviewAddComment top={composeTop} drafting={draftAnchorY !== null} />
          )
        : null}
      {!open || draftAnchorY === null || composeTop === null || (!preset && !('Draft' in rootParts))
        ? null
        : // Compact: the compose box floats where the compact card does — at column width
          // inside the viewport's edge — because a 300px card in the 32px strip is cut.
          takeRoot(
            'Draft',
            <ReviewDraft top={composeTop} left={compact ? metrics.compactCardLeft : null} />
          )}
      {/* Mounted open OR closed: the balloon is how a reader inspects a change whose rail
          card is filtered away, and a closed pane filters ALL of them away. */}
      {preset || 'Balloon' in rootParts ? takeRoot('Balloon', <ReviewBalloon />) : null}
    </>
  );

  const list = (
    <ReviewList
      stack={stack}
      positions={stacked}
      collapsed={collapsedKeys}
      scale={metrics.scale}
      offset={metrics.top}
      window={window_}
    >
      {rootChildren.rest}
    </ReviewList>
  );
  const markerLayer = <ReviewMarkers scale={metrics.scale} offset={metrics.top} window={window_} />;
  // Compact: the strip shows the markers, and only the ACTIVE decision gets a card —
  // floated at column width, pinned just inside the viewport's right edge, over the page.
  // The full run of cards has nowhere honest to be at this width; one at a time does.
  const activeRoot = compact
    ? (roots.find((entry) => entry.key === review.activeKey) ?? null)
    : null;
  // An active item whose page has produced no placement yet has no anchor; the card still
  // has to appear (the click asked for it), so it takes the top of the visible band the
  // way the expanded list keeps unplaced cards in the column.
  const compactTop =
    activeRoot === null
      ? null
      : activeRoot.anchorY !== null
        ? metrics.top + activeRoot.anchorY * metrics.scale
        : window_ !== null
          ? window_.top + RAIL_OVERSCAN + 24
          : null;
  // The same card resolution as ReviewList, from the same template: the List part's
  // children (render prop, `Card` part, or part overrides plus extra children), else the
  // root's. Without it compact swaps in the packaged parts the host hid or replaced.
  // `preset={false}` with no template of its own floats nothing. Under `asChild` the child
  // is the rail ELEMENT, never a card template, so the packaged card stands there.
  const fromList = listCardTemplate(rootChildren.rest, rootParts.List);
  const cardTemplate = asChild ? null : fromList.template;
  const listParts =
    typeof cardTemplate === 'function' ? null : partitionReviewChildren(cardTemplate, 'list');
  const compactCardInner = fromList.hidden ? null : typeof cardTemplate === 'function' ? (
    activeRoot && cardTemplate(activeRoot)
  ) : listParts?.parts.Card && isValidElement<{ className?: string }>(listParts.parts.Card) ? (
    cloneReviewCard(listParts.parts.Card, cardClassName)
  ) : preset || fromList.fromList ? (
    <ReviewCard {...(cardClassName ? { className: cardClassName } : {})}>
      {listParts?.rest}
    </ReviewCard>
  ) : null;
  const compactCard =
    activeRoot && compactTop !== null && metrics.compactCardLeft !== null && compactCardInner ? (
      <ReviewItemContext.Provider value={activeRoot}>
        <div
          className="docx-review__slot docx-review__slot--compact"
          data-testid="review-compact-card"
          style={{
            position: 'absolute',
            top: compactTop,
            left: metrics.compactCardLeft,
            width: COMPACT_CARD_WIDTH,
          }}
        >
          {compactCardInner}
        </div>
      </ReviewItemContext.Provider>
    ) : null;
  // `preset={false}` supplies no defaults, but an explicit compound part still inherits the
  // geometry only the root can calculate. Unrecognized host nodes remain verbatim.
  const body = expanded ? (
    preset || 'List' in rootParts ? (
      takeRoot('List', list)
    ) : typeof rootChildren.rest === 'function' ? null : (
      rootChildren.rest
    )
  ) : preset || 'Markers' in rootParts ? (
    // Closed or compact, the rail keeps its anchors and drops everything else: a small
    // marker per item in the margin, which is how a reader sees there is something to
    // read without giving up the width. Clicking one opens the pane on that item —
    // and, compact, floats that item's card.
    <>
      {takeRoot('Markers', markerLayer)}
      {compactCard}
    </>
  ) : typeof rootChildren.rest === 'function' ? null : (
    rootChildren.rest
  );

  return (
    <ResolvedDisclosureProvider items={items}>
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
              // The same presentation switch as the packaged element: a compact rail is
              // 32px wide (`:not([data-open])`), and mounting the full list inside it
              // rendered every card squeezed to that width over the page.
              preset ? (
                expanded ? (
                  <ReviewList
                    stack={stack}
                    positions={stacked}
                    collapsed={collapsedKeys}
                    scale={metrics.scale}
                    offset={metrics.top}
                    window={window_}
                  />
                ) : (
                  <>
                    {markerLayer}
                    {compactCard}
                  </>
                )
              ) : null,
              affordances
            )}
          </Slot>
        ) : (
          <aside {...shared}>
            {expanded && furniture !== undefined ? (
              <div className="docx-review__furniture" data-testid="review-furniture">
                {furniture}
              </div>
            ) : null}
            {body}
            {affordances}
          </aside>
        )}
      </ReviewContext.Provider>
    </ResolvedDisclosureProvider>
  );
}

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
  readonly Resolve: typeof ReviewResolve;
  readonly Reopen: typeof ReviewReopen;
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
  /**
   * The decision balloon opened by clicking a tracked change in the page: format and
   * structural changes always, every change under `revisionsIn: 'balloons'`.
   */
  readonly Balloon: typeof ReviewBalloon;
}

/**
 * The review rail: comments and tracked changes as a compound component.
 *
 * `DocxEditorReview` is itself the root; every part hangs off it, so a host arranges the pieces
 * it wants rather than accepting one fixed layout. Requires the review module to be registered
 * via `createDocxEditor({ modules: [reviewModule()] })` — without it there is nothing to derive
 * cards from.
 *
 * @example
 * ```tsx
 * <DocxEditorReview>
 *   <DocxEditorReview.List>
 *     <DocxEditorReview.Card>
 *       <DocxEditorReview.Author />
 *       <DocxEditorReview.Summary />
 *       <DocxEditorReview.Accept />
 *       <DocxEditorReview.Reject />
 *     </DocxEditorReview.Card>
 *   </DocxEditorReview.List>
 * </DocxEditorReview>
 * ```
 *
 * @public
 */
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
  Resolve: ReviewResolve,
  Reopen: ReviewReopen,
  Delete: ReviewDelete,
  Replies: ReviewReplies,
  Reply: ReviewReply,
  Markers: ReviewMarkers,
  AddComment: ReviewAddComment,
  Draft: ReviewDraft,
  Balloon: ReviewBalloon,
});

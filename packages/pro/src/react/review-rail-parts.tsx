/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The rail's positioned parts: the card list, the collapsed markers, the comment
// affordance, and the page balloon. The Vue twin is `../vue/review-rail-parts.tsx`.

import { isValidElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { TranslationKey } from '@docx-editor.dev/i18n';
import { Slot, useDocxEditor, useEditorEvent, useEditorState } from '@docx-editor.dev/react';
import type { ReviewItemView } from './useReview.ts';
import type { ReviewMarkersProps, ReviewPartProps } from './review-types.ts';
import {
  ReviewItemContext,
  useRail,
  useReviewLabel,
  type ReviewLabelParams,
} from './review-context.ts';
import {
  MARKER_STEP,
  REVIEW_DATE_FORMAT,
  guardMousedown,
  idsOf,
  initialsOf,
  isThreadedReply,
} from './review-shared.ts';
import { cloneReviewCard, partitionReviewChildren } from './review-composition.tsx';
import { authorAccent, authorCardStyle, authorSlot } from './review-author-styles.ts';
import {
  ADD_COMMENT_ICON,
  icon,
  markerIconPath,
  resolvedCommentIcon,
  reviewBadge,
} from './review-icons.tsx';
import { useResolvedDisclosure } from './review-comment-resolution.tsx';
import { revisionItemLabel, revisionLabelKey } from './review-labels.ts';
import {
  activeItemNeedsBalloon,
  anchorFromRevisionElement,
  balloonBox,
  remeasureBalloonAnchor,
  balloonServesRevisionKind,
  findPaintedRevisionElement,
  matchBalloonReviewItem,
  type BalloonAnchor,
} from './review-balloon-anchor.ts';
import {
  ReviewAccept,
  ReviewAuthor,
  ReviewAvatar,
  ReviewBalloonReply,
  ReviewCard,
  ReviewEmpty,
  ReviewReject,
  ReviewReplies,
  ReviewSummary,
  ReviewTime,
} from './review-card-parts.tsx';

export interface ReviewListProps {
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
export function ReviewList({
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
  const { review, measure, cardClassName } = useRail();
  if (hidden) return null;

  const listChildren =
    typeof children === 'function' ? null : partitionReviewChildren(children, 'list');
  const present = idsOf(review.items);
  const roots = review.items.filter((entry) => !isThreadedReply(entry, present));

  if (roots.length === 0) {
    if (typeof children === 'function') return null;
    return listChildren?.parts.Empty ?? <ReviewEmpty />;
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
              ) : listChildren?.parts.Card &&
                isValidElement<{ className?: string }>(listChildren.parts.Card) ? (
                cloneReviewCard(listChildren.parts.Card, cardClassName)
              ) : (
                <ReviewCard {...(cardClassName ? { className: cardClassName } : {})}>
                  {listChildren?.rest}
                </ReviewCard>
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
 * The collapsed rail: one marker per item, at its anchor — or just below the previous
 * marker, when the anchors are closer than a marker is tall.
 *
 * @public
 */
export function ReviewMarkers({
  scale = 1,
  offset = 0,
  window: visible = null,
  className,
  hidden,
  icon: iconOverride,
}: ReviewMarkersProps) {
  const { review, authorSlots, authorInfo, commentMarkers } = useRail();
  const resolvedDisclosure = useResolvedDisclosure();
  const t = useReviewLabel();
  const { roots, stackedTops } = useMemo(() => {
    const present = idsOf(review.items);
    const entries = review.items.filter((entry) => !isThreadedReply(entry, present));
    const tops = new Map<string, number>();
    let cursor = Number.NEGATIVE_INFINITY;
    for (const entry of entries) {
      if (entry.anchorY === null) continue;
      const top = Math.max(offset + entry.anchorY * scale, cursor);
      tops.set(entry.key, top);
      cursor = top + MARKER_STEP;
    }
    return { roots: entries, stackedTops: tops };
  }, [review.items, offset, scale]);
  if (hidden) return null;
  return (
    <div className={`docx-review__markers${className ? ` ${className}` : ''}`}>
      {roots.map((entry) => {
        const top = stackedTops.get(entry.key);
        if (top === undefined) return null;
        if (visible && (top < visible.top || top > visible.bottom)) return null;
        const custom = typeof iconOverride === 'function' ? iconOverride(entry) : iconOverride;
        const badge = custom == null && commentMarkers === 'initials' && entry.kind === 'comment';
        return (
          <button
            key={entry.key}
            type="button"
            className="docx-review__marker"
            data-testid="review-marker"
            data-kind={entry.kind === 'revision' ? entry.revisionKind : entry.kind}
            {...(badge ? { 'data-marker': 'initials' } : {})}
            {...(entry.author
              ? {
                  'data-review-author': entry.author,
                  'data-review-author-slot': authorSlot(
                    authorInfo.get(entry.author),
                    authorSlots.get(entry.author) ?? 0
                  ),
                }
              : {})}
            style={{
              position: 'absolute',
              top,
              ...(entry.author
                ? ({
                    '--doc-review-author-current': authorAccent(
                      authorInfo.get(entry.author),
                      authorSlots.get(entry.author) ?? 0
                    ),
                  } as CSSProperties)
                : {}),
            }}
            title={entry.author ? `${entry.author}: ${entry.text}` : entry.text}
            aria-label={markerLabel(entry, t)}
            onMouseDown={guardMousedown}
            onClick={() => {
              if (entry.kind === 'comment' && entry.resolved) resolvedDisclosure.open(entry.key);
              review.setPaneOpen(true);
              review.setActive(entry.key);
            }}
          >
            {custom ??
              (entry.kind !== 'comment'
                ? icon(markerIconPath(entry))
                : badge
                  ? reviewBadge(entry.initials, entry.replyIds.length, entry.resolved)
                  : entry.resolved
                    ? resolvedCommentIcon()
                    : icon(markerIconPath(entry)))}
          </button>
        );
      })}
    </div>
  );
}
ReviewMarkers.docxReviewPart = 'Markers' as const;

/** A marker's accessible name: what opening it shows, whose it is, and its thread state. */
function markerLabel(
  entry: ReviewItemView,
  t: (key: TranslationKey, params?: ReviewLabelParams) => string
): string {
  const parts = [
    `${t('review.showPane')}: ${entry.author ? `${entry.author}. ` : ''}${entry.text}`,
  ];
  if (entry.kind === 'comment' && entry.resolved) parts.push(t('review.resolved'));
  if (entry.kind === 'comment' && entry.replyIds.length > 0) {
    parts.push(t('review.replyCount', { count: entry.replyIds.length }));
  }
  return parts.join('. ');
}

/**
 * The "comment on this" button, beside the selected text.
 *
 * Appears only for a RANGE. A comment on a caret has nothing to point at, and the file format writes
 * none, so the affordance is absent rather than present-and-refusing.
 *
 * @public
 */
export function ReviewAddComment({
  top = null,
  drafting = false,
  className,
  hidden,
  children,
}: ReviewPartProps & { top?: number | null; drafting?: boolean }) {
  const { beginDraft, readOnly } = useRail();
  const t = useReviewLabel();
  // Offered for ANY range, including one inside an existing comment: overlapping comments
  // are ordinary in OOXML, and a reader picking out three words of a
  // commented sentence usually has something new to say about exactly those words. This used
  // to hide whenever a card was open, which was really a fix for the button landing on top of
  // that card — solved instead by moving it onto the page edge, where nothing else sits.
  if (hidden || drafting || top === null || readOnly) return null;
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
 * The decision balloon: CLICKING a tracked change in the PAGE opens its card beside the
 * text — author, what changed, when, and accept/reject where the engine can resolve it —
 * and the card stays until a press lands somewhere that is neither a tracked change nor the
 * balloon itself. Click-opened on purpose: a hover-opened card vanished under the pointer
 * travelling toward its own buttons.
 *
 * WHICH KINDS depends on the `revisionsIn` review pane setting. Under `'pane'` only the kinds
 * whose rail cards are hidden by default: a format or structural change has nothing but its
 * grey/washed marking, so the click on that marking is where its decision lives. Under
 * `'balloons'` every tracked change, because the rail then lists comments only; the balloon
 * adds the change's replies and a reply line, and it also closes on Escape and on typing.
 *
 * Matches the pressed element against the UNFILTERED queue, attribution first and POSITION
 * last: the `(id, author, date)` triple, then `(id, author)`, then the id, then the span's
 * own paragraph range against the items' ranges — real files drift on attribution, and the
 * range is the one thing the painter and the review model cannot disagree about. A format or
 * structural element matching nothing still shows what its DOM carries, without actions.
 *
 * @public
 */
export function ReviewBalloon({ className, hidden }: ReviewPartProps) {
  const editor = useDocxEditor();
  const editorRef = useRef(editor);
  editorRef.current = editor;
  const { review, allItems, authorSlots, authorInfo, revisionsIn } = useRail();
  const t = useReviewLabel();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [anchor, setAnchor] = useState<BalloonAnchor | null>(null);
  const navigationAnchorKeyRef = useRef<string | null>(null);
  const displayMode = useEditorState((snapshot) => snapshot.reviewDisplayMode ?? 'all-markup');
  // Whether the active item was opened on purpose (Next/Previous Change, `setActive`) rather
  // than by a caret that happened to land in it.
  const explicit = review.activatedKey !== null;
  useEffect(() => {
    navigationAnchorKeyRef.current = null;
    setAnchor(null);
  }, [displayMode]);
  // Counts `reviewItemReveal` events. Next/Previous Change and `setActive` fire one on every
  // landing, the active item included, so a balloon the reader closed opens again even though
  // the active key did not move. A caret move fires none.
  const [revealCount, setRevealCount] = useState(0);
  // A change balloon that Next/Previous Change (or an announced `setActive`) opens takes the
  // focus, so a keyboard reader reaches Accept and Reject with Tab; Escape gives it back.
  const focusPendingRef = useRef(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useEditorEvent('reviewItemReveal', () => {
    focusPendingRef.current = revisionsInRef.current === 'balloons';
    setRevealCount((count) => count + 1);
  });
  const navigationActive = allItems.find((entry) => entry.isActive) ?? null;
  const navigationActiveRef = useRef(navigationActive);
  navigationActiveRef.current = navigationActive;
  const navigationActiveKey = navigationActive?.key ?? null;
  const navigationNeedsBalloon =
    navigationActive !== null &&
    activeItemNeedsBalloon(navigationActive, review.items, review.paneOpen, revisionsIn, explicit);
  // Whether a balloon is up, readable from the listeners without re-binding them.
  const openRef = useRef(false);
  openRef.current = anchor !== null;
  const revisionsInRef = useRef(revisionsIn);
  revisionsInRef.current = revisionsIn;

  const entry = useMemo(
    () => (anchor ? matchBalloonReviewItem(anchor, allItems) : null),
    [allItems, anchor]
  );
  // A drifted id that happened to land on a CONTENT decision must not raise a balloon over
  // text whose card is beside the page — unless the rail hands every change to the balloon.
  const served = entry && balloonServesRevisionKind(entry.revisionKind, revisionsIn) ? entry : null;
  const servedKeyRef = useRef<string | null>(null);
  servedKeyRef.current = served?.key ?? null;

  useEffect(() => {
    const host = rootRef.current;
    const rail = host?.closest('.docx-review') as HTMLElement | null;
    // The engine's own scroll-container class first: `offsetParent` needs layout, which a
    // DOM without a renderer (happy-dom) does not do, and the viewport always carries it.
    const scroller = (rail?.closest('.docx-editor__scroll-container') ??
      rail?.offsetParent) as HTMLElement | null;
    if (!host || !rail || !scroller) return undefined;

    const close = (): void => {
      navigationAnchorKeyRef.current = null;
      setAnchor(null);
    };
    // Capture-phase press listeners; nothing runs at pointer-movement frequency.
    // Observation only: the press still moves the caret exactly as it did before the
    // balloon existed. A press anywhere that is not a qualifying change closes the card.
    const onDown = (event: Event): void => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      // Pressing the balloon itself (accept, reject, the reply line) is not a dismissal.
      if (host.contains(target)) return;
      // A press keeps the focus where the reader put it.
      focusPendingRef.current = false;
      const element = target.closest('[data-revision-id]');
      if (element instanceof HTMLElement && scroller.contains(element)) {
        const structuralSite = element.classList.contains('docx-table-row--revision');
        if (
          element.dataset.revisionKind === 'format' ||
          structuralSite ||
          revisionsInRef.current === 'balloons'
        ) {
          navigationAnchorKeyRef.current = null;
          setAnchor(anchorFromRevisionElement(element, rail, structuralSite));
          return;
        }
      }
      if (openRef.current) close();
    };
    // Typing never happens under a change balloon. The reply line's own input is exempt.
    const onInput = (event: Event): void => {
      if (revisionsInRef.current !== 'balloons' || !openRef.current) return;
      if (event.target instanceof Node && host.contains(event.target)) return;
      close();
    };
    // Bubble phase, and only when no other control already handled the key.
    // Only a key from this editor counts: the page, a dialog, or another editor keeps its own
    // Escape. A key that ends an IME composition is the input method's, not a dismissal.
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
      if (revisionsInRef.current !== 'balloons' || !openRef.current) return;
      if (!(event.target instanceof Node) || !scroller.contains(event.target)) return;
      // Focus inside the balloon would land on `<body>` once it unmounts.
      const hadFocus = host.contains(host.ownerDocument.activeElement);
      close();
      if (hadFocus) editorRef.current?.focus();
    };
    // BOTH press events, not mousedown alone. The surface cancels `pointerdown` when it
    // places the caret, and a cancelled pointerdown SUPPRESSES the compatibility mousedown
    // outright — a mousedown-only listener never heard a real click on the page, only
    // synthetic ones, which is exactly how that bug shipped. The rare double delivery
    // (chrome areas cancel nothing) re-runs a handler that converges on the same state.
    scroller.addEventListener('pointerdown', onDown, true);
    scroller.addEventListener('mousedown', onDown, true);
    scroller.addEventListener('beforeinput', onInput, true);
    host.ownerDocument.addEventListener('keydown', onKey);
    return () => {
      scroller.removeEventListener('pointerdown', onDown, true);
      scroller.removeEventListener('mousedown', onDown, true);
      scroller.removeEventListener('beforeinput', onInput, true);
      host.ownerDocument.removeEventListener('keydown', onKey);
    };
  }, []);

  // Next/Previous Change (or a host's `setActive`) can activate a decision the rail does not
  // draw. The pointer path already opens the balloon on click; this mirrors that when the
  // engine marks the item active without a qualifying press on its painted site.
  useEffect(() => {
    const host = rootRef.current;
    const rail = host?.closest('.docx-review') as HTMLElement | null;
    const scroller = (rail?.closest('.docx-editor__scroll-container') ??
      rail?.offsetParent) as HTMLElement | null;
    if (!host || !rail || !scroller) return undefined;

    const active = navigationActiveRef.current;
    // A page click can move the caret without activating its rail-hidden format item.
    // Keep that click-opened balloon until a later press or display-mode change closes it.
    if (!active) {
      if (navigationAnchorKeyRef.current !== null) {
        navigationAnchorKeyRef.current = null;
        setAnchor(null);
      }
      return undefined;
    }

    if (!navigationNeedsBalloon) {
      // The caret following a click into the change the balloon already shows keeps it.
      if (revisionsIn === 'balloons' && servedKeyRef.current === active.key) return undefined;
      navigationAnchorKeyRef.current = null;
      setAnchor(null);
      return undefined;
    }

    // A reveal of the decision already open keeps its balloon rather than redrawing it.
    if (openRef.current && navigationAnchorKeyRef.current === active.key) return undefined;
    // Do not show the previous decision while the new painted site catches up.
    navigationAnchorKeyRef.current = active.key;
    setAnchor(null);
    let cancelled = false;
    const frame = requestAnimationFrame(() => {
      if (cancelled) return;
      const element = findPaintedRevisionElement(scroller, active);
      if (!element) {
        setAnchor(null);
        return;
      }
      setAnchor(
        anchorFromRevisionElement(
          element,
          rail,
          element.classList.contains('docx-table-row--revision')
        )
      );
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [displayMode, navigationActiveKey, navigationNeedsBalloon, revisionsIn, revealCount]);

  // The balloon stands on painted geometry: measure it again after a repaint, a zoom change,
  // or a resize of the scroll container, or it drifts away from its text.
  const zoom = useEditorState((snapshot) => snapshot.zoom);
  const [layoutTick, setLayoutTick] = useState(0);
  useEditorEvent('change', () => setLayoutTick((tick) => tick + 1));
  const servedRef = useRef(served);
  servedRef.current = served;
  const balloonOpen = anchor !== null;
  useEffect(() => {
    if (!balloonOpen) return undefined;
    const rail = rootRef.current?.closest('.docx-review') as HTMLElement | null;
    const scroller = (rail?.closest('.docx-editor__scroll-container') ??
      rail?.offsetParent) as HTMLElement | null;
    if (!rail || !scroller) return undefined;
    const remeasure = (): void =>
      setAnchor((current) =>
        current ? remeasureBalloonAnchor(current, scroller, rail, servedRef.current) : current
      );
    let frame = requestAnimationFrame(remeasure);
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(remeasure);
          });
    observer?.observe(scroller);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [balloonOpen, zoom, layoutTick]);

  // Resolving the decision removes it from the queue; the balloon it was resolved from
  // must not linger over the text the accept just changed. A reply the reader is typing is
  // the exception: the balloon stays on the resolved change and keeps the text, and the
  // reply line says why it cannot be posted.
  const hadEntry = useRef(false);
  const lastServedRef = useRef<BalloonEntry | null>(null);
  if (served) lastServedRef.current = served;
  const replyDraftRef = useRef(false);
  // Derived during render, not in an effect: a render without the change would unmount the
  // reply line and lose its text before an effect could keep it.
  const orphan =
    !served && anchor !== null && revisionsIn === 'balloons' && replyDraftRef.current
      ? lastServedRef.current
      : null;
  const orphanRef = useRef(orphan);
  orphanRef.current = orphan;
  const onReplyDraft = useCallback((hasText: boolean) => {
    replyDraftRef.current = hasText;
    // A cleared line on a resolved change has nothing left to keep.
    if (!hasText && orphanRef.current !== null) setAnchor(null);
  }, []);
  useEffect(() => {
    if (served) {
      hadEntry.current = true;
      return;
    }
    if (hadEntry.current) {
      hadEntry.current = false;
      if (orphanRef.current === null) setAnchor(null);
    }
  }, [served]);
  const shownEntry = served ?? orphan;

  const changeBalloonKey = anchor !== null && revisionsIn === 'balloons' ? served?.key : undefined;
  useEffect(() => {
    if (changeBalloonKey === undefined || !focusPendingRef.current) return;
    focusPendingRef.current = false;
    dialogRef.current?.focus({ preventScroll: true });
  }, [changeBalloonKey, revealCount]);

  if (hidden) return null;
  const fallbackKind = anchor?.kind === 'format' ? ('format' as const) : ('structural' as const);
  // An unmatched TEXT change has nothing honest to show: its label would claim a structure.
  const unmatchedContent =
    anchor !== null && !shownEntry && anchor.kind !== 'format' && !anchor.structuralSite;
  const changeBalloon = revisionsIn === 'balloons' && shownEntry !== null;
  const orphaned = served === null && orphan !== null;
  const box = anchor ? balloonBox(anchor, changeBalloon ? 300 : 280) : null;
  const shown = !(
    anchor === null ||
    displayMode !== 'all-markup' ||
    unmatchedContent ||
    (shownEntry && review.items.some((item) => item.id === shownEntry.id) && review.paneOpen)
  );
  // Read out what opened, also when focus stays in the page (a click on the change).
  const announcement =
    shown && changeBalloon && served && served.item.kind === 'revision'
      ? t('review.changeAnnouncement', {
          change: revisionItemLabel(served.item, t),
          author: served.author || t('comments.unknown'),
          text: served.text,
        })
      : '';

  return (
    // The wrapper always mounts — it is what the wiring effect climbs from — and carries
    // no box of its own until there is a balloon to show.
    <div ref={rootRef} className={`docx-review__balloon-root${className ? ` ${className}` : ''}`}>
      <span className="docx-editor-sr-only" aria-live="polite" data-testid="review-balloon-live">
        {announcement}
      </span>
      {!shown || anchor === null ? null : (
        <div
          className="docx-review__balloon"
          data-testid="review-balloon"
          {...(changeBalloon ? { 'data-variant': 'change' } : {})}
          style={{
            left: box!.left,
            width: box!.width,
            top: anchor.above ? anchor.top - 6 : anchor.bottom + 6,
            transform: anchor.above ? 'translateY(-100%)' : undefined,
          }}
          onMouseDown={guardMousedown}
        >
          {shownEntry ? (
            <ReviewItemContext.Provider value={shownEntry}>
              <div
                className="docx-review__card"
                data-testid="review-balloon-card"
                data-kind={shownEntry.revisionKind ?? 'revision'}
                // Gated, as the card and the fallback balloon are: an anonymous change would
                // otherwise carry `data-review-author=""` and match a host's `[data-review-author]`.
                {...(shownEntry.author
                  ? {
                      'data-review-author': shownEntry.author,
                      'data-review-author-slot': authorSlot(
                        authorInfo.get(shownEntry.author),
                        authorSlots.get(shownEntry.author) ?? 0
                      ),
                    }
                  : {})}
                {...(changeBalloon
                  ? {
                      ref: dialogRef,
                      role: 'dialog',
                      tabIndex: -1,
                      'aria-label': t('review.trackedChange'),
                    }
                  : {})}
                style={authorCardStyle(
                  shownEntry.author,
                  authorInfo.get(shownEntry.author),
                  authorSlots.get(shownEntry.author) ?? 0
                )}
                // A change balloon is already open on its change; activating it again would
                // move the caret out from under the reply line the reader is typing into.
                onClick={
                  changeBalloon || orphaned ? undefined : () => review.setActive(shownEntry.key)
                }
              >
                <div className="docx-review__head">
                  <ReviewAvatar />
                  <div className="docx-review__meta">
                    <ReviewAuthor />
                    <ReviewTime />
                  </div>
                  {shownEntry.kind === 'revision' && !shownEntry.readOnly && !orphaned ? (
                    <div className="docx-review__actions">
                      <ReviewAccept />
                      <ReviewReject />
                    </div>
                  ) : null}
                </div>
                {changeBalloon ? <BalloonChangeSummary entry={shownEntry} /> : <ReviewSummary />}
                {changeBalloon ? (
                  <>
                    <ReviewReplies />
                    <ReviewBalloonReply
                      key={shownEntry.key}
                      entry={shownEntry}
                      orphaned={orphaned}
                      onDraft={onReplyDraft}
                    />
                  </>
                ) : null}
              </div>
            </ReviewItemContext.Provider>
          ) : (
            <div
              className="docx-review__card"
              data-testid="review-balloon-card"
              data-kind={fallbackKind}
              {...(anchor.author
                ? {
                    'data-review-author': anchor.author,
                    'data-review-author-slot': authorSlot(
                      authorInfo.get(anchor.author),
                      authorSlots.get(anchor.author) ?? 0
                    ),
                  }
                : {})}
              style={authorCardStyle(
                anchor.author,
                authorInfo.get(anchor.author),
                authorSlots.get(anchor.author) ?? 0
              )}
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

/**
 * What a change balloon says the change did: the verb, then the words themselves — added
 * words as added, removed words struck, and a replacement as both in one line. Kinds with
 * no words of their own (format, structural, paragraph marks) keep the card's summary.
 * The words come from the document and render as text, never as markup.
 */
function BalloonChangeSummary({ entry }: { readonly entry: BalloonEntry }) {
  const t = useReviewLabel();
  const kind = entry.revisionKind;
  if (kind === 'replace') {
    return (
      <div className="docx-review__summary" data-testid="review-summary" data-review-selectable="">
        <span className="docx-review__label" data-kind="replace">
          {t('review.replaced')}
        </span>{' '}
        <del className="docx-review__removed">{entry.replacedText}</del>{' '}
        <ins className="docx-review__added">{entry.text}</ins>
      </div>
    );
  }
  const added = kind === 'insert' || kind === 'moveTo';
  if (!added && kind !== 'delete' && kind !== 'moveFrom') return <ReviewSummary />;
  return (
    <div className="docx-review__summary" data-testid="review-summary" data-review-selectable="">
      <span className="docx-review__label" data-kind={kind}>
        {revisionItemLabel(entry.item, t)}
      </span>{' '}
      {added ? (
        <ins className="docx-review__added">{entry.text}</ins>
      ) : (
        <del className="docx-review__removed">{entry.text}</del>
      )}
    </div>
  );
}

type BalloonEntry = Extract<ReviewItemView, { readonly kind: 'revision' }>;

/** `ReviewTime` for a raw dataset date, outside any item context. */
export function BalloonTime({ raw }: { raw: string }) {
  const when = new Date(raw);
  if (Number.isNaN(when.getTime())) return null;
  return (
    <time className="docx-review__time" dateTime={raw}>
      {REVIEW_DATE_FORMAT.format(when)}
    </time>
  );
}

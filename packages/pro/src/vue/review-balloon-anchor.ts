/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/

import type { RevisionDisplay } from '@docx-editor.dev/core/editor';
import type { ReviewItemView } from './useReview.ts';

type BalloonReviewItem = Extract<ReviewItemView, { readonly kind: 'revision' }>;

/** What a tracked change site carries before matching it to a review decision. */
export interface BalloonAnchor {
  readonly revisionId: string;
  readonly formattingKind?: string;
  readonly author: string;
  readonly date?: string;
  readonly kind?: string;
  readonly structuralSite: boolean;
  readonly paragraphId?: string;
  readonly start?: number;
  readonly end?: number;
  /** The site's box, relative to the rail. */
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
  readonly above: boolean;
  /** Whether the site's text runs right to left, so the balloon starts at its right edge. */
  readonly rtl: boolean;
  /** The scroll container's visible box, relative to the rail. */
  readonly visibleLeft: number;
  readonly visibleRight: number;
}

/** Room the balloon keeps from the visible edge of the scroll container, in CSS px. */
export const BALLOON_EDGE_PX = 8;

export function anchorFromRevisionElement(
  element: HTMLElement,
  rail: HTMLElement,
  structuralSite: boolean
): BalloonAnchor {
  const railRect = rail.getBoundingClientRect();
  const rect = element.getBoundingClientRect();
  const scroller = element.closest('.docx-editor__scroll-container');
  const scrollerRect = scroller?.getBoundingClientRect();
  const visibleLeft = (scrollerRect?.left ?? railRect.left) - railRect.left;
  // `clientWidth` leaves out a vertical scrollbar; a box with no layout reports zero.
  const visibleWidth =
    scroller && scroller.clientWidth > 0 ? scroller.clientWidth : (scrollerRect?.width ?? 0);
  const viewportBottom = element.ownerDocument.defaultView?.innerHeight ?? Infinity;
  const start = Number(element.dataset.reviewStart ?? element.dataset.start);
  const end = Number(element.dataset.reviewEnd ?? element.dataset.end);
  return {
    revisionId: element.dataset.revisionId!,
    ...(element.dataset.formattingKind ? { formattingKind: element.dataset.formattingKind } : {}),
    author: element.dataset.reviewAuthor ?? '',
    ...(element.dataset.revisionDate !== undefined ? { date: element.dataset.revisionDate } : {}),
    ...(element.dataset.revisionKind !== undefined ? { kind: element.dataset.revisionKind } : {}),
    structuralSite,
    ...(element.dataset.paragraphId !== undefined
      ? { paragraphId: element.dataset.paragraphId }
      : {}),
    ...(Number.isFinite(start) ? { start } : {}),
    ...(Number.isFinite(end) ? { end } : {}),
    left: rect.left - railRect.left,
    right: rect.right - railRect.left,
    top: rect.top - railRect.top,
    bottom: rect.bottom - railRect.top,
    above: rect.bottom + 220 > viewportBottom,
    rtl: element.ownerDocument.defaultView?.getComputedStyle(element).direction === 'rtl',
    visibleLeft,
    visibleRight: visibleWidth > 0 ? visibleLeft + visibleWidth : Number.POSITIVE_INFINITY,
  };
}

/**
 * The balloon's left edge and width, relative to the rail. The balloon starts at the site's
 * inline start (its left edge, or its right edge in right-to-left text), and stays inside
 * the scroll container's visible width: it narrows on a narrow viewport and moves inward
 * near the edge.
 */
export function balloonBox(
  anchor: BalloonAnchor,
  preferredWidth: number
): { readonly left: number; readonly width: number } {
  const room = anchor.visibleRight - anchor.visibleLeft - 2 * BALLOON_EDGE_PX;
  const width = Number.isFinite(room) && room > 0 ? Math.min(preferredWidth, room) : preferredWidth;
  const start = anchor.rtl ? anchor.right - width : anchor.left;
  const min = anchor.visibleLeft + BALLOON_EDGE_PX;
  const max = anchor.visibleRight - BALLOON_EDGE_PX - width;
  return { left: Math.min(Math.max(start, min), Math.max(max, min)), width };
}

/**
 * The painted site an open balloon stands on, found again after a repaint replaced the
 * element: the same change, author, kind, and text offset first, else the change's first site.
 */
function findAnchorElement(
  scroller: HTMLElement,
  anchor: BalloonAnchor,
  served: ReviewItemView | null
): HTMLElement | null {
  let first: HTMLElement | null = null;
  for (const node of scroller.querySelectorAll('[data-revision-id]')) {
    if (!(node instanceof HTMLElement) || node.dataset.revisionId !== anchor.revisionId) continue;
    if ((node.dataset.reviewAuthor ?? '') !== anchor.author) continue;
    if (node.dataset.formattingKind !== anchor.formattingKind) continue;
    if (node.classList.contains('docx-table-row--revision') !== anchor.structuralSite) continue;
    const start = Number(node.dataset.reviewStart ?? node.dataset.start);
    if (node.dataset.paragraphId === anchor.paragraphId && start === anchor.start) return node;
    first ??= node;
  }
  return first ?? (served ? findPaintedRevisionElement(scroller, served) : null);
}

const GEOMETRY = [
  'left',
  'right',
  'top',
  'bottom',
  'above',
  'rtl',
  'visibleLeft',
  'visibleRight',
] as const;

/**
 * Measure an open balloon's site again, after a repaint, a zoom change, or a resize of the
 * scroll container. Returns the same object when nothing moved, so a caller that stores it
 * does not render again, and the previous anchor when the site is not painted.
 */
export function remeasureBalloonAnchor(
  anchor: BalloonAnchor,
  scroller: HTMLElement,
  rail: HTMLElement,
  served: ReviewItemView | null
): BalloonAnchor {
  const element = findAnchorElement(scroller, anchor, served);
  if (!element) return anchor;
  const next = anchorFromRevisionElement(element, rail, anchor.structuralSite);
  return GEOMETRY.every((key) => next[key] === anchor[key]) ? anchor : { ...anchor, ...next };
}

/**
 * Whether the page balloon serves this revision kind. Format and structural changes always
 * have it. With `revisionsIn: 'balloons'` every tracked change does, because the rail lists
 * comments only.
 */
export function balloonServesRevisionKind(
  revisionKind: string | undefined,
  revisionsIn: RevisionDisplay = 'pane'
): boolean {
  if (revisionKind === undefined) return false;
  return revisionsIn === 'balloons' || revisionKind === 'format' || revisionKind === 'structural';
}

/**
 * True when the active item's decision belongs in the page balloon, not the rail column.
 *
 * With `revisionsIn: 'balloons'`, any tracked change opens only when it was activated
 * explicitly: by Next/Previous Change or by `setActive`. A caret that merely lands in a
 * change, or in a tracked table row, must not raise a balloon over the text being typed.
 */
export function activeItemNeedsBalloon(
  item: ReviewItemView,
  railItems: readonly ReviewItemView[],
  paneOpen: boolean,
  revisionsIn: RevisionDisplay = 'pane',
  explicit = false
): boolean {
  if (item.kind !== 'revision' || !balloonServesRevisionKind(item.revisionKind, revisionsIn)) {
    return false;
  }
  // The rail lists no change in this mode, so only an explicit activation, of any kind,
  // opens the balloon. A click on the page opens it through the pointer path instead.
  if (revisionsIn === 'balloons') return explicit;
  return !(paneOpen && railItems.some((entry) => entry.id === item.id));
}

/** A painted text site, as opposed to a format span or a table-row marker. */
export function isContentRevisionSite(element: HTMLElement): boolean {
  return (
    element.dataset.revisionKind !== 'format' &&
    !element.classList.contains('docx-table-row--revision')
  );
}

/** Find a painted revision site for an active decision without interpolating file data into selectors. */
export function findPaintedRevisionElement(
  scroller: HTMLElement,
  item: ReviewItemView
): HTMLElement | null {
  if (item.kind !== 'revision' || item.item.kind !== 'revision') return null;
  const addresses = item.item.addresses;
  if (addresses.length === 0) return null;
  const ids = new Set(addresses.map((address) => address.id));
  const formattingKind = item.item.formattingKind;
  for (const node of scroller.querySelectorAll('[data-revision-id]')) {
    if (!(node instanceof HTMLElement)) continue;
    const revisionId = node.dataset.revisionId;
    if (!revisionId || !ids.has(revisionId)) continue;
    const addressMatches = addresses.some(
      (address) =>
        address.id === revisionId &&
        address.author === (node.dataset.reviewAuthor ?? '') &&
        (address.date ?? '') === (node.dataset.revisionDate ?? '')
    );
    if (!addressMatches) continue;
    const structuralSite = node.classList.contains('docx-table-row--revision');
    if (item.revisionKind === 'structural' && structuralSite) return node;
    if (
      item.revisionKind === 'format' &&
      node.dataset.revisionKind === 'format' &&
      node.dataset.formattingKind === formattingKind
    ) {
      return node;
    }
    // A content change, or either half of a paired replacement, anchors on its first span.
    if (!balloonServesRevisionKind(item.revisionKind) && isContentRevisionSite(node)) return node;
  }
  return null;
}

/** Match a painted site to one decision, with range fallback for attribution drift. */
export function matchBalloonReviewItem(
  anchor: BalloonAnchor,
  items: readonly ReviewItemView[]
): BalloonReviewItem | null {
  let byAuthor: BalloonReviewItem | null = null;
  let byAuthorAmbiguous = false;
  let byId: BalloonReviewItem | null = null;
  let byIdAmbiguous = false;
  let byRange: BalloonReviewItem | null = null;
  let byRangeAmbiguous = false;
  for (const candidate of items) {
    if (candidate.kind !== 'revision' || candidate.item.kind !== 'revision') continue;
    if (anchor.formattingKind && candidate.item.formattingKind !== anchor.formattingKind) continue;
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
      anchor.paragraphId === undefined ||
      anchor.start === undefined ||
      anchor.end === undefined ||
      (candidate.revisionKind !== 'format' && candidate.revisionKind !== 'structural')
    ) {
      continue;
    }
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
  if (byAuthor !== null && !byAuthorAmbiguous) return byAuthor;
  if (byId !== null && !byIdAmbiguous) return byId;
  if (byRange !== null && !byRangeAmbiguous) return byRange;
  return null;
}

/** Run/paragraph formatting has painted anchors; other formatting needs a sidebar fallback. */
export function hasFormattingBalloon(item: ReviewItemView): boolean {
  return (
    item.kind === 'revision' &&
    item.item.kind === 'revision' &&
    item.revisionKind === 'format' &&
    item.item.ranges.length > 0 &&
    (item.item.formattingKind === 'rPrChange' || item.item.formattingKind === 'pPrChange')
  );
}

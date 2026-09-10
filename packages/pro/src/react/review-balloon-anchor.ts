/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/

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
  readonly left: number;
  readonly top: number;
  readonly bottom: number;
  readonly above: boolean;
}

export function anchorFromRevisionElement(
  element: HTMLElement,
  rail: HTMLElement,
  structuralSite: boolean
): BalloonAnchor {
  const railRect = rail.getBoundingClientRect();
  const rect = element.getBoundingClientRect();
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
    top: rect.top - railRect.top,
    bottom: rect.bottom - railRect.top,
    above: rect.bottom + 220 > viewportBottom,
  };
}

export function balloonServesRevisionKind(revisionKind: string | undefined): boolean {
  return revisionKind === 'format' || revisionKind === 'structural';
}

/** True when the active item's decision belongs in the page balloon, not the rail column. */
export function activeItemNeedsBalloon(
  item: ReviewItemView,
  railItems: readonly ReviewItemView[],
  paneOpen: boolean
): boolean {
  if (item.kind !== 'revision' || !balloonServesRevisionKind(item.revisionKind)) return false;
  return !(paneOpen && railItems.some((entry) => entry.id === item.id));
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

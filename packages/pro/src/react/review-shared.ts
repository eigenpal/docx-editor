/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Constants and small helpers the review rail's modules share. The Vue twin is
// `../vue/review-shared.ts`.

import type { MouseEvent as ReactMouseEvent } from 'react';
import type { EditorSnapshot, ReviewItemQuery } from '@docx-editor.dev/core/contracts/editor';
import type { ReviewItemView } from './useReview.ts';

/**
 * True while the editor has NO painted document: still loading one, the one it was handed
 * would not parse, or bytes are held but detached from any mount point. Not `isLoading`
 * alone — a parse failure clears that flag (so hosts can put their own error screen up),
 * and handed-over-but-detached bytes clear it too, while in both states there is nothing
 * for a card to anchor to. `pageSetup` is null in exactly those states.
 */
export const selectDocumentAbsent = (snapshot: EditorSnapshot) =>
  snapshot.isLoading || snapshot.parseError !== null || snapshot.pageSetup == null;
/** The `opening` review pane setting. */
export const selectPaneOpening = (snapshot: EditorSnapshot) => snapshot.reviewPane.opening;
/** The `revisionsIn` review pane setting. */
export const selectRevisionsIn = (snapshot: EditorSnapshot) => snapshot.reviewPane.revisionsIn;
/** The `commentMarkers` review pane setting. */
export const selectCommentMarkers = (snapshot: EditorSnapshot) =>
  snapshot.reviewPane.commentMarkers;
export const selectDocumentReadOnly = (snapshot: EditorSnapshot) =>
  snapshot.editingMode === 'viewing';

/** The compose affordance's place in the stacking run. Not a review item; never rendered. */
export const COMPOSE_KEY = '\u0000compose';

/** What an unmeasured, uncollapsed card reserves in the stacking run, in CSS px. */
export const DEFAULT_CARD_HEIGHT = 72;
/** A collapsed card: the head row and its padding, in CSS px. */
export const COLLAPSED_CARD_HEIGHT = 64;
/**
 * How far (CSS px) a card may be pushed below its own text before it collapses to a
 * header. Roughly half a viewport: nearer than that the eye still connects card to text;
 * further, a full card reads as annotating whatever happens to be beside it.
 */
export const COLLAPSE_DISPLACEMENT_PX = 480;
/** A rail marker is a 28 CSS px box; the step keeps 2px of air between stacked markers. */
export const MARKER_STEP = 30;

/** Stable query for the balloon's unplaced queue read — never allocate per render. */
export const NO_PLACEMENT_REVIEW_QUERY = Object.freeze({
  placement: false,
}) satisfies ReviewItemQuery;
/** The balloon's queue under `revisionsIn: 'balloons'`: a typed-over range is one decision. */
export const PAIRED_REVIEW_QUERY = Object.freeze({
  placement: false,
  pairReplacements: true,
}) satisfies ReviewItemQuery;

/**
 * Whether `revisionsIn: 'balloons'` moves this entry out of the rail: every tracked change, and
 * every comment that replies to one (the balloon draws it under the change).
 */
export function servedByChangeBalloon(entry: ReviewItemView): boolean {
  return (
    entry.kind === 'revision' || (entry.kind === 'comment' && entry.parentRevisionId !== undefined)
  );
}

/**
 * Whether this entry renders INSIDE another card rather than as one of its own.
 *
 * Two kinds of reply, one rule. A threaded reply belongs in the comment it answers; a reply to
 * a TRACKED CHANGE is also a comment — OOXML gives `w:ins` and `w:del` no body, so the text is
 * written over the change's own range — and belongs in the change's card. Everywhere the rail
 * lists roots asks this, because a filter that checked only `parentId` drew a reply to a
 * revision twice: once inside the change and once beside it.
 */
export function isThreadedReply(entry: ReviewItemView, present: ReadonlySet<string>): boolean {
  if (entry.kind !== 'comment') return false;
  // A parent this list does not hold is not a parent HERE. The engine already drops a link
  // its own `excludeRevisionKinds` filter broke, but a consumer's `filter` prop can break one
  // too, and a comment excluded as a reply to a card nobody draws is a comment that vanishes.
  // Falling back to root is the only answer that always renders it somewhere.
  if (entry.parentId !== undefined) return present.has(entry.parentId);
  if (entry.parentRevisionId !== undefined) return present.has(entry.parentRevisionId);
  return false;
}

/** Ids of everything the rail is working from, for the reply/root test above. */
export function idsOf(items: readonly ReviewItemView[]): ReadonlySet<string> {
  return new Set(items.map((entry) => entry.id));
}

/** Keeps the caret: a mousedown that bubbles to the editor moves it. Inputs are exempt. */
export function guardMousedown(event: ReactMouseEvent): void {
  const tag = (event.target as HTMLElement | null)?.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  event.preventDefault();
}

/** Initials for the dataset-only fallback, matching the engine's own derivation. */
export function initialsOf(author: string): string {
  const words = author.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  return words
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join('');
}

/** Locale-aware, so a translated rail is not left with an English date. */
export const REVIEW_DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/

import { Fragment, isVNode, type VNode } from 'vue';
import type { EditorSnapshot, ReviewItemQuery } from '@docx-editor.dev/core/contracts/editor';
import type { ReviewItemView } from './useReview.ts';

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

export { COMPACT_CARD_WIDTH } from '../review/rail-metrics.ts';
export const COMPOSE_KEY = '\u0000compose';
export { RAIL_OVERSCAN } from '../review/rail-window.ts';
export const AUTHOR_SLOTS = 8;
export const DEFAULT_CARD_HEIGHT = 72;
export const COLLAPSED_CARD_HEIGHT = 64;
export const COLLAPSE_DISPLACEMENT_PX = 480;
export const MARKER_STEP = 30;

export const NO_PLACEMENT_REVIEW_QUERY = Object.freeze({
  placement: false,
  pairReplacements: false,
}) satisfies ReviewItemQuery;
/** The balloon's queue under `revisionsIn: 'balloons'`: a typed-over range is one decision. */
export const PAIRED_REVIEW_QUERY = Object.freeze({
  placement: false,
  pairReplacements: true,
}) satisfies ReviewItemQuery;

export function isThreadedReply(entry: ReviewItemView, present: ReadonlySet<string>): boolean {
  if (entry.kind !== 'comment') return false;
  if (entry.parentId !== undefined) return present.has(entry.parentId);
  if (entry.parentRevisionId !== undefined) return present.has(entry.parentRevisionId);
  return false;
}

export function idsOf(items: readonly ReviewItemView[]): ReadonlySet<string> {
  return new Set(items.map((entry) => entry.id));
}

export function guardMousedown(event: MouseEvent): void {
  const tag = (event.target as HTMLElement | null)?.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  event.preventDefault();
}

export function initialsOf(author: string): string {
  const words = author.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  return words
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join('');
}

export { reviewDateFormat } from '../review/review-date-format.ts';

export function partOverrides(
  children: VNode | VNode[] | undefined
): Record<string, VNode | VNode[]> {
  const found: Record<string, VNode | VNode[]> = {};
  const extra: VNode[] = [];
  const visit = (nodes: VNode | VNode[] | undefined): void => {
    if (!nodes) return;
    const list = Array.isArray(nodes) ? nodes : [nodes];
    for (const node of list) {
      if (!isVNode(node)) continue;
      if (node.type === Fragment) {
        visit(node.children as VNode | VNode[]);
        continue;
      }
      const marker = (node.type as { docxReviewPart?: string }).docxReviewPart;
      if (marker) found[marker] = node;
      else extra.push(node);
    }
  };
  visit(children);
  if (extra.length > 0) found.__extra = extra;
  return found;
}

export function markPart<T>(component: T, part: string): T {
  (component as { docxReviewPart: string }).docxReviewPart = part;
  return component;
}

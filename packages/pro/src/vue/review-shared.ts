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
export const selectDocumentReadOnly = (snapshot: EditorSnapshot) =>
  snapshot.editingMode === 'viewing';

export interface RailMetrics {
  readonly scale: number;
  readonly top: number;
  readonly left: number | null;
}

export const INITIAL_METRICS: RailMetrics = { scale: 96 / 72, top: 0, left: null };
export const RAIL_GUTTER = 16;
export const COMPOSE_KEY = '\u0000compose';
export const RAIL_OVERSCAN = 600;
export const AUTHOR_SLOTS = 8;
export const DEFAULT_CARD_HEIGHT = 72;
export const COLLAPSED_CARD_HEIGHT = 64;
export const COLLAPSE_DISPLACEMENT_PX = 480;
export const MARKER_STEP = 30;

export const NO_PLACEMENT_REVIEW_QUERY = Object.freeze({
  placement: false,
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

export const REVIEW_DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

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

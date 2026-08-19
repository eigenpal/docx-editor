/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/

import type { ReviewActivationOptions } from '@docx-editor.dev/core/contracts/editor';
import type { VNode } from 'vue';
import type { ReviewItemView } from './useReview.ts';

/** @public */
export interface ReviewPartProps {
  className?: string;
  asChild?: boolean;
  hidden?: boolean;
  children?: VNode | VNode[];
}

/** @public */
export interface ReviewActionProps extends ReviewPartProps {
  icon?: VNode | string;
}

/** @public */
export interface ReviewMarkersProps extends ReviewPartProps {
  scale?: number;
  offset?: number;
  window?: { top: number; bottom: number } | null;
  icon?: VNode | ((item: ReviewItemView) => VNode | null | undefined);
}

/** @public */
export interface ReviewProps extends Omit<ReviewPartProps, 'children' | 'hidden'> {
  t?: (key: string, params?: Record<string, string | number>) => string;
  card?: { className?: string };
  furniture?: VNode | VNode[];
  preset?: boolean;
  stack?: boolean;
  gap?: number;
  filter?: (item: ReviewItemView) => boolean;
  structural?: boolean;
  formatting?: boolean;
  hidden?: boolean;
  /** Scoped slot for custom card render: `#default="{ item }"`. */
  children?: VNode | VNode[];
}

/** Plain review actions stored in rail context — not ComputedRefs. @internal */
export interface ReviewActions {
  readonly items: readonly ReviewItemView[];
  readonly activeKey: string | null;
  setActive(key: string | null, options?: ReviewActivationOptions): boolean;
  accept(item: ReviewItemView): boolean;
  reject(item: ReviewItemView): boolean;
  resolve(item: ReviewItemView): boolean;
  reopen(item: ReviewItemView): boolean;
  readonly commentResolutionDisabledReason: string | null;
  remove(item: ReviewItemView): boolean;
  reply(item: ReviewItemView, text: string, author?: string): boolean;
  readonly selectionAnchorY: number | null;
  comment(text: string, author?: string): boolean;
  readonly paneOpen: boolean;
  setPaneOpen(open: boolean): void;
  readonly ready: boolean;
}

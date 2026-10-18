/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/

import type { ReviewActivationOptions } from '@docx-editor.dev/core/contracts/editor';
import type { VNode } from 'vue';
import type { ReviewAdoptOptions, ReviewItemView } from './useReview.ts';
import type { ReviewWriteRefusal } from '../review/review-refusal.ts';

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

/**
 * Props for `DocxEditorReview.Balloon`, the balloon that opens a review item at its text:
 * each tracked change under `revisionsIn: 'balloons'`, and format and structural changes in
 * every mode.
 *
 * @public
 */
export interface ReviewBalloonProps {
  /** A class added to the balloon element. */
  className?: string;
  /**
   * Remove the built-in balloon, for example to render your own. Format and structural
   * change balloons go with it.
   */
  hidden?: boolean;
}

/**
 * Props of `DocxEditorReview.Draft`.
 *
 * @public
 */
export interface ReviewDraftProps extends ReviewPartProps {
  /**
   * Rail-local `top` in CSS pixels. Omit it to use the packaged card stack's position. Pass
   * your own when you render your own cards, so the box stacks with them.
   */
  top?: number;
  /**
   * Rail-local `left` for the compact rail. Omit it to use the compact card's position in the
   * compact rail and the rail's own column otherwise. Null keeps the box in the rail's column.
   */
  left?: number | null;
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
  readonly activatedKey: string | null;
  setActive(key: string | null, options?: ReviewActivationOptions): boolean;
  accept(item: ReviewItemView): boolean;
  reject(item: ReviewItemView): boolean;
  adopt(items: ReviewItemView | readonly ReviewItemView[], options?: ReviewAdoptOptions): boolean;
  resolve(item: ReviewItemView): boolean;
  reopen(item: ReviewItemView): boolean;
  readonly commentResolutionDisabledReason: string | null;
  remove(item: ReviewItemView): boolean;
  reply(item: ReviewItemView, text: string, author?: string): boolean;
  readonly selectionAnchorY: number | null;
  comment(text: string, author?: string): boolean;
  readonly lastRefusal: ReviewWriteRefusal | null;
  readonly paneOpen: boolean;
  setPaneOpen(open: boolean): void;
  readonly ready: boolean;
}

/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The public prop types of the review rail and its parts. The Vue twin is
// `../vue/review-types.ts`.

import type { ReactNode } from 'react';
import type { ToolbarTranslate } from '@docx-editor.dev/react';
import type { ReviewItemView } from './useReview.ts';

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
export interface ReviewProps extends Omit<ReviewPartProps, 'children'> {
  /**
   * Label resolver, as `DocxEditor.Toolbar`, `.Menu` and `.ContextMenu` take one. Unresolved
   * keys fall back to the bundled catalogue rather than to the key.
   */
  t?: ToolbarTranslate;
  /** Class for each card. The rail's own `className` styles the column; this the boxes in it. */
  card?: { className?: string };
  /**
   * Compound parts for the rail and its implicit List. A function remains supported as the
   * legacy shorthand for a List render callback, but cannot be combined with root siblings;
   * prefer an explicit `<Review.List>{item => ...}</Review.List>` in new code.
   *
   * ```tsx
   * <DocxEditor.Review>
   *   <DocxEditor.Review.List>{(item) => <MyCard item={item} />}</DocxEditor.Review.List>
   * </DocxEditor.Review>
   * ```
   */
  children?: ReactNode | ((item: ReviewItemView) => ReactNode);
  /**
   * Host content at the top of the rail, above the cards — filters, legends, summaries.
   *
   * Rendered only while the pane is OPEN. A closed rail gives up its width for a 32px strip
   * of markers, and content laid out for the 300px column has nowhere to go in it; unmounting
   * is the rail's own business, not something a host should have to subscribe to `paneOpen`
   * to discover. Furniture that should outlive the toggle belongs outside the rail.
   */
  furniture?: ReactNode;
  /**
   * Render the packaged arrangement. `false` mounts the rail and its context only, so a host
   * can lay the cards out itself while keeping the subscription and the anchoring. Explicit
   * compound parts still inherit root-owned geometry; no omitted part is added back.
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
   * Show structural changes in the sidebar. Default `true`: row, cell, merge, and
   * numbering decisions must remain discoverable even without a clickable page marker.
   * Set `false` to hide their cards; painted row markers still open a balloon.
   */
  structural?: boolean;
  /**
   * Show formatting changes in the rail. Default `false`: inspect formatting in the
   * page balloon. Changes without a painted formatting anchor stay in the sidebar.
   * Set `true` to include all formatting decisions in the sidebar.
   */
  formatting?: boolean;
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
 * Props for the collapsed rail's gutter markers. @public
 *
 * `scale`, `offset` and `window` are the rail's own geometry and are supplied for you — an
 * override inherits them, so a host passes only what it wants to change.
 */
export interface ReviewMarkersProps {
  scale?: number;
  offset?: number;
  /** Visible band of the scroller; markers outside it are not mounted. */
  window?: { top: number; bottom: number } | null;
  className?: string;
  hidden?: boolean;
  /**
   * Replace the glyph. A FUNCTION of the item, unlike the action parts' plain node, because
   * one `Markers` draws every marker in the gutter — a single node would put one shape on all
   * of them, which is the thing this part was fixed to stop doing. Return null or undefined
   * for an item to keep its packaged glyph.
   */
  icon?: ReactNode | ((item: ReviewItemView) => ReactNode);
}

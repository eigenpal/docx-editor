/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * The review module: comments, tracked changes, and markup rendering as an
 * `EditorModule` for `createDocxEditor({ modules })`.
 *
 * Registering it is the whole enablement story: the review chrome slots light
 * up through the same `toolbarCommandState` they were disabled by, suggesting
 * mode becomes reachable, and the editor renders revisions in markup rather
 * than the free tier's final-state projection.
 */

import { createRevisionMarkupDialog } from './revision-markup-dialog';
import {
  resolveReviewPane,
  type EditorModule,
  type ReviewPaneOptions,
} from '@docx-editor.dev/core/editor';
import { collectReviewItems, revisionItemsOfParagraph } from './review-model.ts';
import { rememberLicenseKey, type ProLicenseOptions } from '../license.ts';

export type {
  CommentMarkerStyle,
  ResolvedReviewPane,
  ReviewPaneOpening,
  ReviewPaneOptions,
  ReviewPaneOverflow,
  RevisionDisplay,
} from '@docx-editor.dev/core/editor';

/**
 * How {@link reviewModule} is configured. Every field is optional, so `reviewModule()`
 * with no argument is the ordinary call.
 *
 * @public
 */
export interface ReviewModuleOptions extends ProLicenseOptions {
  /**
   * The review pane settings the editor starts with. Change them later with
   * `editor.setReviewPaneOptions()`, and read them from `snapshot.reviewPane`. Pass
   * `{ opening: 'manual' }` when the host shows review items its own way, for example in
   * balloons or margin markers, and opens the pane only on demand. An unknown field or
   * value throws a `TypeError`.
   */
  readonly pane?: ReviewPaneOptions;
}

/** Build the review module. Construction never validates the key and never touches the network. */
export function reviewModule(options: ReviewModuleOptions = {}): EditorModule {
  // Validate now, so a misspelled setting fails where the host wrote it.
  const pane = options.pane === undefined ? undefined : { ...resolveReviewPane(options.pane) };
  rememberLicenseKey(options.licenseKey);
  return {
    id: 'review',
    review: {
      createRevisionMarkupDialog,
      displayModes: ['all-markup', 'simple-markup', 'proposed', 'original'],
      collectReviewItems,
      revisionItemsOfParagraph,
      ...(pane ? { pane } : {}),
    },
  };
}

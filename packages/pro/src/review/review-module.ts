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
import type { EditorModule } from '@docx-editor.dev/core/editor';
import { collectReviewItems, revisionItemsOfParagraph } from './review-model.ts';
import { rememberLicenseKey, type ProLicenseOptions } from '../license.ts';

/**
 * How {@link reviewModule} is configured. Every field is optional, so `reviewModule()`
 * with no argument is the ordinary call.
 *
 * @public
 */
export interface ReviewModuleOptions extends ProLicenseOptions {
  /**
   * Whether the editor opens the review pane by itself. Default `'automatic'`: the pane
   * opens when a document with review items loads, and when a tracked change is made while
   * the pane is closed. Pass `'manual'` when the host shows review items its own way, for
   * example in balloons or margin markers, and opens the pane only on demand. Any other
   * value throws a `TypeError`.
   */
  readonly paneOpening?: 'automatic' | 'manual';
}

/** Build the review module. Construction never validates the key and never touches the network. */
export function reviewModule(options: ReviewModuleOptions = {}): EditorModule {
  const { paneOpening } = options;
  if (paneOpening !== undefined && paneOpening !== 'automatic' && paneOpening !== 'manual') {
    throw new TypeError(`reviewModule: paneOpening must be 'automatic' or 'manual'`);
  }
  rememberLicenseKey(options.licenseKey);
  return {
    id: 'review',
    review: {
      createRevisionMarkupDialog,
      displayModes: ['all-markup', 'simple-markup', 'proposed', 'original'],
      collectReviewItems,
      revisionItemsOfParagraph,
      ...(paneOpening ? { paneOpening } : {}),
    },
  };
}

/**
 * The review module: comments, tracked changes, and markup rendering as an
 * `EditorModule` for `createDocxEditor({ modules })`.
 *
 * Registering it is the whole enablement story: the review chrome slots light
 * up through the same `toolbarCommandState` they were disabled by, suggesting
 * mode becomes reachable, and the editor renders revisions in markup rather
 * than the free tier's final-state projection.
 */

import type { EditorModule } from '@docx-editor.dev/core-contract/editor';
import { collectReviewItems } from './review-model.ts';
import { rememberLicenseKey, type ProLicenseOptions } from '../license.ts';

export interface ReviewModuleOptions extends ProLicenseOptions {}

/** Build the review module. Construction never validates the key and never touches the network. */
export function reviewModule(options: ReviewModuleOptions = {}): EditorModule {
  rememberLicenseKey(options.licenseKey);
  return {
    id: 'review',
    review: {
      displayModes: ['all-markup', 'proposed', 'original'],
      collectReviewItems,
    },
  };
}

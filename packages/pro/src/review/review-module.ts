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
 * than the free tier's final-state projection. It also installs the drawing renderers, as
 * `drawingModule()` from `@docx-editor.dev/pro/drawing` does.
 */

import { createRevisionMarkupDialog } from './revision-markup-dialog';
import { createCompareDocumentsDialog } from './compare-documents-dialog';
import {
  resolveReviewPane,
  type EditorModule,
  type ReviewPaneOptions,
} from '@docx-editor.dev/core/editor';
import { collectReviewItems, revisionItemsOfParagraph } from './review-model.ts';
import type { ProLicenseOptions } from '../license.ts';
import { installDrawing } from '../drawing/index.ts';
import { compareDocumentsEngine } from '../compare/index.ts';
import { createCompareWorkerEngine } from '../compare/worker-engine.ts';
import { startDefaultCompareWorker } from '../compare-worker-default.ts';

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
  /**
   * The worker that runs the Compare documents dialog's compares off the page's main thread,
   * so the page stays responsive, the dialog shows progress, and Cancel stops a running
   * compare. By default, the editor starts the packaged worker,
   * `@docx-editor.dev/pro/compare-worker`, one for each compare.
   *
   * Pass `false` to compare on the main thread. Pass a function that starts the worker if your
   * bundler cannot find the packaged one. If a worker fails to start, the dialog compares on
   * the main thread instead, and that compare cannot be stopped.
   *
   * @example A Vite worker import
   * ```ts
   * import CompareWorker from '@docx-editor.dev/pro/compare-worker?worker';
   * reviewModule({ compareWorker: () => new CompareWorker() });
   * ```
   */
  readonly compareWorker?: (() => Worker) | false;
}

/**
 * Build the review module. Construction never validates the key and never touches the network.
 * It installs the drawing renderers process-wide, so charts, SmartArt layout, drawing effects,
 * WordArt, and metafile pictures render without a separate `drawingModule()`.
 */
export function reviewModule(options: ReviewModuleOptions = {}): EditorModule {
  // Validate now, so a misspelled setting fails where the host wrote it.
  const pane = options.pane === undefined ? undefined : { ...resolveReviewPane(options.pane) };
  installDrawing(options);
  const worker = options.compareWorker;
  if (worker !== undefined && worker !== false && typeof worker !== 'function')
    throw new TypeError(
      'reviewModule: compareWorker must be false or a function that returns a Worker'
    );
  // The packaged worker by default. Where it cannot start, compares run on the main thread.
  const background =
    worker === false ? undefined : createCompareWorkerEngine(worker ?? startDefaultCompareWorker);
  return {
    id: 'review',
    review: {
      compareDocuments: compareDocumentsEngine,
      ...(background ? { compareDocumentsInBackground: background } : {}),
      createCompareDocumentsDialog,
      createRevisionMarkupDialog,
      displayModes: ['all-markup', 'simple-markup', 'proposed', 'original'],
      collectReviewItems,
      revisionItemsOfParagraph,
      ...(pane ? { pane } : {}),
    },
  };
}

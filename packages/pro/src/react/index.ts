/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * `@docx-editor.dev/pro/react` — React chrome for the review rail and custom nodes.
 *
 * Compound components over the pro modules: arrange the parts you want rather than accepting one
 * fixed layout. Requires the matching module to be registered on the editor — without it there
 * is nothing to derive cards or chips from.
 *
 * @example Render the review rail
 * ```tsx
 * import { DocxEditorReview } from '@docx-editor.dev/pro/react';
 *
 * <DocxEditorReview>
 *   <DocxEditorReview.List>
 *     <DocxEditorReview.Card>
 *       <DocxEditorReview.Author />
 *       <DocxEditorReview.Summary />
 *     </DocxEditorReview.Card>
 *   </DocxEditorReview.List>
 * </DocxEditorReview>
 * ```
 *
 *
 * The review pane and its headless hook, plus the module factory re-exported so
 * a React host imports one path. Compose inside `DocxEditor.Root` from
 * `@docx-editor.dev/react` with the review module registered.
 *
 * @packageDocumentation
 * @public
 */

export { reviewModule, type ReviewModuleOptions } from '../review/review-module.ts';
export {
  collaborationModule,
  type CollaborationModuleOptions,
} from '../collaboration/collaboration-module.ts';
export { type ProLicenseOptions } from '../license.ts';
export {
  DocxEditorReview,
  useReviewAuthor,
  useReviewItem,
  type DocxEditorReviewNamespace,
  type ReviewActionProps,
  type ReviewMarkersProps,
  type ReviewPartProps,
  type ReviewProps,
} from './DocxEditorReview';
export { CustomNodeChrome, type CustomNodeChromeProps } from './CustomNodeChrome.tsx';
export {
  CustomNodeContextMenu,
  type CustomNodeContextMenuProps,
} from './CustomNodeContextMenu.tsx';
export {
  activatedCustomNodeOf,
  resolveCustomNodeActivation,
  useCustomNodeDefinitions,
  type ResolvedCustomNodeActivation,
} from './custom-node-activation.ts';
export {
  useReview,
  useReviewOf,
  useStackedReviewPositions,
  type ReviewActivationOptions,
  type ReviewItemView,
  type UseReviewReturn,
} from './useReview';
export {
  useCollaborationStatus,
  type UseCollaborationStatusReturn,
} from './useCollaborationStatus.ts';

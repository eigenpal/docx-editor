/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * Vue review rail — preset layout with {@link useReview} data wiring.
 *
 * Compound part overrides (`List`, `Card`, `Accept`, …) match the React export names and
 * mount when passed as slots; the preset arrangement is the default when no slot overrides
 * are supplied. Full `asChild` merge semantics follow the React ladder and are typed on
 * each part export for hosts that replace individual pieces.
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
  useReviewItem,
  type DocxEditorReviewNamespace,
  type ReviewActionProps,
  type ReviewMarkersProps,
  type ReviewPartProps,
  type ReviewProps,
} from './DocxEditorReview.tsx';
export { useReviewAuthor } from './review-context.ts';
export {
  useReview,
  useReviewOf,
  useStackedReviewPositions,
  type ReviewActivationOptions,
  type ReviewItemView,
  type UseReviewReturn,
} from './useReview.ts';
export {
  useCollaborationStatus,
  type UseCollaborationStatusReturn,
} from './useCollaborationStatus.ts';
export { CustomNodeChrome, type CustomNodeChromeProps } from './CustomNodeChrome.ts';
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

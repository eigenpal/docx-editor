/**
 * `@docx-editor.dev/pro/react` — React chrome for the pro capabilities.
 *
 * The review pane and its headless hook, plus the module factory re-exported so
 * a React host imports one path. Compose inside `DocxEditor.Root` from
 * `@docx-editor.dev/react` with the review module registered.
 */

export { reviewModule, type ReviewModuleOptions } from '../review/review-module.ts';
export { type ProLicenseOptions } from '../license.ts';
export {
  DocxEditorReview,
  type DocxEditorReviewNamespace,
  type ReviewActionProps,
  type ReviewPartProps,
  type ReviewProps,
} from './DocxEditorReview';
export {
  useReview,
  useReviewOf,
  useStackedReviewPositions,
  type ReviewItemView,
  type UseReviewReturn,
} from './useReview';

// Mount options the engine passes to a paginated surface beside the public ones: a font
// remount carries the selection and drawing intent across, and the editor facade shares its
// review author state. Hosts never set these.

import type { SemanticSelection } from '@docx-editor.dev/core/layout';
import type { StableReviewAuthorSlots } from '../output/revision-presentation.ts';
import type {
  DrawingSelectionIntent,
  PaginatedSurfaceOptions,
} from './paginated-surface-contract.ts';
import type { RevisionAuthorVisibility } from './revision-author-visibility.ts';
import type { PendingTextFormInput } from './surface-text-form-fields.ts';

/** The public mount options plus the engine-internal ones. @internal */
export type PaginatedSurfaceRuntimeOptions = PaginatedSurfaceOptions & {
  readonly onTrackedChange?: () => void;
  readonly reviewAuthorSlots?: StableReviewAuthorSlots;
  readonly revisionAuthorVisibility?: RevisionAuthorVisibility;
  /**
   * Carry drawing intent alongside the range on a font remount. A plain open starts
   * with no drawing selected, even when the default caret sits at its anchor.
   */
  readonly initialDrawingSelectionIntent?: DrawingSelectionIntent;
  /** Restore the model range on a font remount without claiming DOM selection/focus. */
  readonly initialSelection?: SemanticSelection;
  readonly initialTextFormInput?: PendingTextFormInput;
};

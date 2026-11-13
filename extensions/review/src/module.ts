// The review capability, written against the engine's public `EditorModule` seam.
//
// Everything here comes from @docx-editor.dev/core (Apache-2.0): the queue derivation
// (`collectReviewItems`) and the per-story revision reader (`revisionItemsOf`). The module
// only tells the editor that review is available and which display modes it may enter.
import type { EditorModule, ReviewDisplayMode } from '@docx-editor.dev/core/contracts/modules';
import { collectReviewItems, revisionItemsOf } from '@docx-editor.dev/core/store';

export interface ReviewModuleOptions {
  /** Display modes the editor may enter. Default: all four Word views. */
  readonly displayModes?: readonly ReviewDisplayMode[];
}

const ALL_MODES: readonly ReviewDisplayMode[] = [
  'all-markup',
  'simple-markup',
  'proposed',
  'original',
];

/** Create the review module. Pass it in `modules` once, when the editor is built. */
export function reviewModule(options: ReviewModuleOptions = {}): EditorModule {
  return {
    id: 'review',
    review: {
      displayModes: options.displayModes ?? ALL_MODES,
      collectReviewItems,
      // Revisions wholly inside one paragraph: the engine uses these for its fast local
      // patch after a text edit in that paragraph.
      revisionItemsOfParagraph: (part, paragraphId) =>
        revisionItemsOf(part).filter((item) =>
          item.ranges.every(
            (range) =>
              range.start.paragraphId === paragraphId && range.end.paragraphId === paragraphId
          )
        ),
    },
  };
}

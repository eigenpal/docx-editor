// Modified in the Grant Workbench fork of docx-editor (Eigenpal, Inc., Apache-2.0), 2026. See FORK-CHANGES.md.
// A STUB review module for the free adapter's tests.
//
// These tests exercise seam mechanics (the editing-mode pill enabling, review
// slots lighting up) which key on a review contribution being registered, not
// on what it derives. The real module and the review pane live in
// the review module, whose own tests cover the derived queue.

import type { EditorModule } from '@docx-editor.dev/core/editor';

export function testReviewModule(): EditorModule {
  return {
    id: 'review',
    review: {
      displayModes: ['all-markup', 'proposed', 'original'],
      collectReviewItems: () => [],
      revisionItemsOfParagraph: () => [],
    },
  };
}

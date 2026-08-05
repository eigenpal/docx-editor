// The review module the CORE tests register.
//
// Review functionality is module-gated: a bare `createDocxEditor` is the free
// tier — final-state rendering, refused review writes — and the tests in this
// tree that exercise suggesting, the queue, and the pane are testing the
// MODULE-REGISTERED behavior. This helper is the in-tree stand-in for the pro
// package's `reviewModule()`; when the derivation physically moves there, these
// tests move with it and import the real one.

import type { EditorModule } from '../../contracts/modules.ts';
import { collectReviewItems } from '../../layout/review-model.ts';

export function testReviewModule(): EditorModule {
  return {
    id: 'review',
    review: {
      displayModes: ['all-markup', 'proposed', 'original'],
      collectReviewItems,
    },
  };
}

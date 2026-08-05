// The review module the ADAPTER tests register — review behavior is module-gated
// in the engine, and these tests exercise the module-registered path. Stand-in
// for the pro package's `reviewModule()` until the derivation moves there.

import type { EditorModule } from '@docx-editor.dev/core-contract/editor';
import { collectReviewItems } from '@docx-editor.dev/core-contract/layout';

export function testReviewModule(): EditorModule {
  return {
    id: 'review',
    review: {
      displayModes: ['all-markup', 'proposed', 'original'],
      collectReviewItems,
    },
  };
}

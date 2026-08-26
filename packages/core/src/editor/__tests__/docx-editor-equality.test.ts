// `snapshotsEqual` honesty (editor lane).
//
// The snapshot cache hands back the PREVIOUS snapshot object whenever `snapshotsEqual`
// says nothing moved. A field the comparator misses is therefore a field that can never
// wake a `useSyncExternalStore` subscriber. `hasReviewContent` was missing from the
// hand-written list; a package-revision backstop hid it. The compile-time map in
// docx-editor-equality.ts now makes omission a type error, and this suite makes it a
// runtime failure: flip any single field and the snapshots must compare unequal.

import { describe, expect, test } from 'bun:test';
import type { EditorSnapshot } from '@docx-editor.dev/core/contracts/editor';
import { snapshotsEqual } from '../docx-editor-equality.ts';

const BASELINE: EditorSnapshot = {
  scope: { kind: 'body' },
  isLoading: false,
  isOpening: false,
  parseError: null,
  editable: true,
  zoom: 1,
  zoomMode: { type: 'fixed' },
  selection: null,
  selectionCollapsed: true,
  formatting: null,
  table: null,
  tocContext: null,
  image: null,
  page: { current: 1, total: 3 },
  canUndo: false,
  canRedo: false,
  pageSetup: null,
  reviewPaneOpen: false,
  hasReviewContent: false,
  collaborationStatus: 'inactive',
  editingMode: 'editing',
  lastRejection: null,
  fontSubstitutions: [],
};

/**
 * One changed value per snapshot field. `snapshotsEqual` compares by `===` after
 * sub-object reuse, so a fresh object or a flipped primitive is enough to count as a
 * move. The `satisfies` clause keeps this table exhaustive: a new `EditorSnapshot`
 * field fails typecheck here until it gets a mutation, the same ratchet the source map
 * carries.
 */
const MUTATIONS = {
  scope: { kind: 'headerFooter', rId: 'rId9' },
  isLoading: true,
  isOpening: true,
  parseError: 'boom',
  editable: false,
  zoom: 2,
  zoomMode: { type: 'fixed' },
  selection: { from: { paraId: 'p1' }, to: { paraId: 'p1' } },
  selectionCollapsed: false,
  formatting: { bold: true },
  table: { rows: 1, columns: 1 },
  tocContext: { id: 'toc-1' },
  image: { id: 'img-1' },
  page: { current: 2, total: 3 },
  canUndo: true,
  canRedo: true,
  pageSetup: { pageWidthTwips: 1 },
  reviewPaneOpen: true,
  hasReviewContent: true,
  collaborationStatus: 'ready',
  editingMode: 'viewing',
  lastRejection: 'refused',
  fontSubstitutions: ['Calibri'],
} satisfies Record<keyof EditorSnapshot, unknown>;

describe('snapshotsEqual compares every EditorSnapshot field', () => {
  test('identical snapshots are equal', () => {
    expect(snapshotsEqual(BASELINE, { ...BASELINE })).toBe(true);
  });

  test('the regression: a hasReviewContent flip is a change', () => {
    const flipped: EditorSnapshot = { ...BASELINE, hasReviewContent: true };
    expect(snapshotsEqual(BASELINE, flipped)).toBe(false);
  });

  for (const key of Object.keys(MUTATIONS) as (keyof EditorSnapshot)[]) {
    test(`a lone ${key} change is a change`, () => {
      const mutated = { ...BASELINE, [key]: MUTATIONS[key] } as EditorSnapshot;
      expect(snapshotsEqual(BASELINE, mutated)).toBe(false);
    });
  }
});

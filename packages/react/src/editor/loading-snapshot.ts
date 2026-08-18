// The one pre-mount read model, shared by every path that answers "no editor yet":
// `useEditorState`'s null-editor and server branches, and the imperative ref's
// pre-mount `snapshot()`. A single frozen constant so those answers can never drift,
// and so `useSyncExternalStore` sees a stable reference across repeated reads.

import type { EditorSnapshot } from '@docx-editor.dev/core/contracts/editor';

/**
 * What `snapshot()` reports before an editor exists: loading, not editable, nothing
 * selected, nothing undoable — never invented state. Frozen, module-level, and
 * reference-stable, as `useSyncExternalStore`'s server/loading snapshot must be.
 */
export const LOADING_SNAPSHOT: EditorSnapshot = Object.freeze({
  scope: Object.freeze({ kind: 'body' as const }),
  isLoading: true,
  isOpening: false,
  parseError: null,
  editable: false,
  zoom: 1,
  selection: null,
  selectionCollapsed: true,
  formatting: null,
  table: null,
  tocContext: null,
  image: null,
  page: Object.freeze({ current: 0, total: 0 }),
  canUndo: false,
  canRedo: false,
});

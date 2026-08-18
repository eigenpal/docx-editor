// The one pre-mount read model, shared by every path that answers "no editor yet".
// Framework-free — both adapters re-export it.

import type { EditorSnapshot } from '../contracts/editor.ts';

/**
 * What `snapshot()` reports before an editor exists: loading, not editable, nothing
 * selected, nothing undoable — never invented state.
 *
 * @public
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

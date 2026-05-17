import { useMemo } from 'react';
import type { EditorState } from 'prosemirror-state';
import {
  extractTrackedChanges,
  type TrackedChangesResult,
} from '@eigenpal/docx-editor-core/prosemirror/utils/extractTrackedChanges';

// Re-export the canonical implementations so existing imports keep working.
export { extractTrackedChanges };
export type { TrackedChangesResult };

/**
 * Returns tracked changes (and the comment→revision overlap map for threading)
 * derived from the latest PM state. Memoized on state identity, so derivation
 * only re-runs when PM state changes (which happens on every doc-changing
 * transaction, including remote ones via ySyncPlugin).
 *
 * No debounce: a single O(N) doc walk, cheap enough to run per transaction.
 * If you see jank on huge documents, wrap the setter that drives the state
 * argument in `requestAnimationFrame` rather than reintroducing a delay here —
 * a delay makes the sidebar feel laggy.
 */
export function useTrackedChanges(state: EditorState | null): TrackedChangesResult {
  return useMemo(() => extractTrackedChanges(state), [state]);
}

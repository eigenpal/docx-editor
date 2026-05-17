/**
 * useTrackedChanges — Vue composable wrapping the framework-agnostic
 * extractTrackedChanges from core. Returns a computed result that
 * re-derives whenever the editor view's transaction count changes.
 */
import { computed, type Ref } from 'vue';
import type { EditorView } from 'prosemirror-view';
import {
  extractTrackedChanges,
  type TrackedChangesResult,
} from '@eigenpal/docx-editor-core/prosemirror/utils/extractTrackedChanges';

export type { TrackedChangesResult };
export { extractTrackedChanges };
export type { TrackedChangeEntry } from '@eigenpal/docx-editor-core/utils/comments';

/**
 * Pass the editor view ref + a stateTick that bumps on every PM
 * transaction (the same tick the Toolbar listens to). The computed
 * re-runs whenever the tick advances.
 */
export function useTrackedChanges(view: Ref<EditorView | null>, stateTick: Ref<number>) {
  return computed<TrackedChangesResult>(() => {
    void stateTick.value;
    return extractTrackedChanges(view.value?.state ?? null);
  });
}

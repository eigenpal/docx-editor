/**
 * useHistory — undo/redo composable wrapping prosemirror-history's
 * `undo` / `redo` commands and `undoDepth` / `redoDepth` selectors.
 *
 * Replaces the previous plugin-key sniff (which walked
 * `view.state.plugins` looking for a key containing 'history') with
 * direct calls to the upstream PM history API. prosemirror-history
 * is a transitive dep via core; declared as a devDep here so the
 * type imports resolve at compile time without making it a hard
 * peer dep for consumers.
 */
import { computed, type Ref } from 'vue';
import type { EditorView } from 'prosemirror-view';
import { undo, redo, undoDepth, redoDepth } from 'prosemirror-history';

export function useHistory(view: Ref<EditorView | null>, stateTick: Ref<number>) {
  const canUndo = computed(() => {
    void stateTick.value;
    const v = view.value;
    return v ? undoDepth(v.state) > 0 : false;
  });
  const canRedo = computed(() => {
    void stateTick.value;
    const v = view.value;
    return v ? redoDepth(v.state) > 0 : false;
  });

  function doUndo(): boolean {
    const v = view.value;
    return v ? undo(v.state, v.dispatch) : false;
  }
  function doRedo(): boolean {
    const v = view.value;
    return v ? redo(v.state, v.dispatch) : false;
  }

  return { canUndo, canRedo, undo: doUndo, redo: doRedo };
}

// Serve Add comment requests from the host's own comment UI. The Vue twin of the React
// `useCommentDraftRequest`.
//
// The `review.addComment` control runs no engine command: a comment needs its text first, and
// the text comes from a draft that chrome owns. The engine enables the control only while some
// chrome is registered to open that draft. The packaged review rail registers itself; a host
// that renders its own comment UI registers with this composable.

import { getCurrentScope, onScopeDispose, watch } from 'vue';
import { useDocxEditor } from './context';

/**
 * Open the host's own comment draft when the `review.addComment` control is pressed.
 *
 * While the component is mounted and `handler` is set, the control is enabled (subject to the
 * engine's other rules: the review module, the editing mode, and a selection). Without any
 * registration the control is disabled, because nothing could open the draft. The most recent
 * registration receives each request. The registration lasts while the calling component is
 * mounted. Passing `null` registers nothing; to stop serving requests, unmount the component, for
 * example with `v-if` while your comment UI cannot open a draft.
 *
 * The handler takes no arguments. Read the selection with `editor.getSelectionPlacement()`,
 * and pin it with `editor.retainSelection()` while the draft is open.
 *
 * @example
 * ```ts
 * const drafting = ref(false);
 * useCommentDraftRequest(() => {
 *   drafting.value = true;
 * });
 * const addComment = useEditorCommand('review.addComment');
 * // Bind `addComment.isEnabled` to the button, and call `addComment.execute()` on click.
 * ```
 *
 * @public
 */
export function useCommentDraftRequest(handler: (() => void) | null | undefined): void {
  const editorRef = useDocxEditor();
  if (typeof handler !== 'function') return;
  let release: (() => void) | undefined;
  const stop = watch(
    () => editorRef.value,
    (editor) => {
      release?.();
      release = editor ? editor.setCommentDraftChrome({ onRequest: handler }) : undefined;
    },
    { immediate: true, flush: 'post' }
  );
  if (getCurrentScope()) {
    onScopeDispose(() => {
      stop();
      release?.();
      release = undefined;
    });
  }
}

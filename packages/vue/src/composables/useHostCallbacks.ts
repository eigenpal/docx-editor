/**
 * Bridges the host-facing `onComment*` and `onEditorViewReady` props into the
 * editor internals, keeping the host SFC lean. The comment callbacks have a
 * stable identity but read the prop at call time, so a swapped callback is
 * always honored. (#720)
 */

import { watch, type Ref } from 'vue';
import type { EditorView } from 'prosemirror-view';
import type { DocxEditorProps } from '../components/DocxEditor/types';
import type { CommentCallbacks } from './useCommentManagement';

export function useHostCallbacks(props: DocxEditorProps, editorView: Ref<EditorView | null>) {
  const commentCallbacks: CommentCallbacks = {
    onCommentAdd: (comment) => props.onCommentAdd?.(comment),
    onCommentResolve: (comment) => props.onCommentResolve?.(comment),
    onCommentDelete: (comment) => props.onCommentDelete?.(comment),
    onCommentReply: (reply, parent) => props.onCommentReply?.(reply, parent),
    onCommentsChange: (list) => props.onCommentsChange?.(list),
  };

  // Fires on each new view: Vue recreates the EditorView on loadDocument/
  // loadBuffer, so the host must receive the live view each time (React reuses
  // a single view).
  watch(editorView, (view) => view && props.onEditorViewReady?.(view), { immediate: true });

  return { commentCallbacks };
}

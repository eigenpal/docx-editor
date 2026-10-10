import { nextTick, onMounted, shallowRef, watch, type ShallowRef } from 'vue';
import type { ReviewAuthorInfo } from '@docx-editor.dev/core/editor';
import { useDocxEditor, useEditorStateTick } from './context';

const EMPTY: readonly ReviewAuthorInfo[] = [];

/** @public */
export function useReviewAuthors(): Readonly<ShallowRef<readonly ReviewAuthorInfo[]>> {
  const editorRef = useDocxEditor();
  const tick = useEditorStateTick();
  const authors = shallowRef<readonly ReviewAuthorInfo[]>(EMPTY);
  const refresh = () => {
    authors.value = editorRef.value?.getReviewAuthors() ?? EMPTY;
  };
  watch(
    [editorRef, tick],
    () => {
      refresh();
      // A new facade is published before Content's sibling watcher attaches its surface.
      // Re-read on the next flush so a fetched document exposes its initial roster.
      void nextTick(refresh);
    },
    { immediate: true, flush: 'post' }
  );
  // Content attaches in a sibling's post-flush watcher. Read once after the whole mount has
  // completed so a synchronously opened document publishes its roster without needing an edit.
  onMounted(() => {
    void nextTick(refresh);
  });
  return authors;
}

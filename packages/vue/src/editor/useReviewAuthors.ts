import type { ShallowRef } from 'vue';
import type { ReviewAuthorInfo } from '@docx-editor.dev/core/editor';
import { useDocxEditor } from './context';
import { useEditorState } from './useEditorState';

const EMPTY: readonly ReviewAuthorInfo[] = [];

/** @public */
export function useReviewAuthors(): Readonly<ShallowRef<readonly ReviewAuthorInfo[]>> {
  const editorRef = useDocxEditor();
  return useEditorState(() => editorRef.value?.getReviewAuthors() ?? EMPTY);
}

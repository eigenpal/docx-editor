import { computed, ref, type ComputedRef } from 'vue';
import type { Editor, EditorSnapshot } from '@docx-editor.dev/core/contracts/editor';
import { useDocxEditor } from '../context';
import { useEditorState } from '../useEditorState';

/** @public */
export type OutlineHeading = ReturnType<Editor['getOutline']>[number];

/** @public */
export interface OutlineHeadingItem {
  readonly heading: OutlineHeading;
  readonly depth: number;
}

/** @public */
export interface UseDocumentOutlineResult {
  readonly headings: ComputedRef<readonly OutlineHeading[]>;
  readonly items: ComputedRef<readonly OutlineHeadingItem[]>;
  readonly selectedBlockId: ComputedRef<string | null>;
  readonly goTo: (blockId: string) => void;
  readonly isEmpty: ComputedRef<boolean>;
}

const EMPTY_HEADINGS: readonly OutlineHeading[] = Object.freeze([]);
const selectSnapshot = (snapshot: EditorSnapshot) => snapshot;

/** @public */
export function useDocumentOutline(): UseDocumentOutlineResult {
  const editorRef = useDocxEditor();
  const snapshot = useEditorState(selectSnapshot);
  const selectedBlockId = ref<string | null>(null);

  const headings = computed(() =>
    editorRef.value && !snapshot.value.isLoading ? editorRef.value.getOutline() : EMPTY_HEADINGS
  );

  const items = computed(() => {
    const list = headings.value;
    if (list.length === 0) return [] as readonly OutlineHeadingItem[];
    let min = list[0]!.level;
    for (const heading of list) if (heading.level < min) min = heading.level;
    return list.map((heading) => ({ heading, depth: heading.level - min }));
  });

  const goTo = (blockId: string) => {
    const editor = editorRef.value;
    if (!editor || typeof blockId !== 'string' || blockId.length === 0) return;
    editorRef.value!.focus();
    const position = { paragraphId: blockId, offset: 0 };
    editorRef.value!.exec({ type: 'setSelection', range: { anchor: position, head: position } });
    editor.scrollToBlock(blockId);
    selectedBlockId.value = blockId;
  };

  return {
    headings,
    items,
    selectedBlockId: computed(() => selectedBlockId.value),
    goTo,
    isEmpty: computed(() => headings.value.length === 0),
  };
}

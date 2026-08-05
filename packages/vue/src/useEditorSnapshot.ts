// Keeping shell chrome in step with the engine (interactive-paginated-editing M5.1).
//
// The Vue counterpart of React's `useEditorSnapshot`. Toolbar enabled state,
// ruler geometry, and the page indicator all READ engine state when they render.
// Reading is correct; not subscribing is not — without this the chrome renders
// once and then lies: the toolbar keeps its first `can()` answer as the
// selection moves, and the rulers keep the first document's page size.

import { onBeforeUnmount, ref, watch, type Ref } from 'vue';
import type { Editor } from '@docx-editor.dev/core/contracts/editor';

/**
 * A counter that increments whenever the editor commits a change, moves the
 * selection, or republishes display. Read it inside a `computed` to make that
 * computed re-evaluate on engine events.
 */
export function useEditorSnapshot(editor: () => Editor | null): Ref<number> {
  const revision = ref(0);
  let dispose: (() => void) | null = null;

  const subscribe = (next: Editor | null): void => {
    dispose?.();
    dispose = null;
    if (!next) return;
    const bump = (): void => {
      revision.value += 1;
    };
    const offChange = next.on('change', bump);
    const offSelection = next.on('selectionChange', bump);
    dispose = () => {
      offChange();
      offSelection();
    };
    bump();
  };

  watch(editor, subscribe, { immediate: true });
  onBeforeUnmount(() => {
    dispose?.();
    dispose = null;
  });

  return revision;
}

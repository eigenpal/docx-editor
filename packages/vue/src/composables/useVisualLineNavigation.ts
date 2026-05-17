/**
 * Vue port of packages/react/src/paged-editor/useVisualLineNavigation.ts.
 * Wraps the framework-agnostic algorithm in core. Same sticky X +
 * across-line nav semantics; the composable just owns the mutable
 * state object.
 */
import { type Ref } from 'vue';
import {
  createVisualLineState,
  getCaretClientX as coreGetCaretClientX,
  findLineElementAtPosition as coreFindLineElementAtPosition,
  findPositionOnLineAtClientX as coreFindPositionOnLineAtClientX,
  handleVisualLineKeyDown,
} from '@eigenpal/docx-editor-core/prosemirror/utils/visualLineNavigation';
import type { EditorView } from 'prosemirror-view';

export function useVisualLineNavigation(pagesContainer: Ref<HTMLElement | null>) {
  const state = createVisualLineState();

  function getCaretClientX(pmPos: number): number | null {
    const c = pagesContainer.value;
    return c ? coreGetCaretClientX(c, pmPos) : null;
  }
  function findLineElementAtPosition(pmPos: number): HTMLElement | null {
    const c = pagesContainer.value;
    return c ? coreFindLineElementAtPosition(c, pmPos) : null;
  }
  function findPositionOnLineAtClientX(line: HTMLElement, clientX: number): number | null {
    return coreFindPositionOnLineAtClientX(line, clientX);
  }
  function handlePMKeyDown(view: EditorView, event: KeyboardEvent): boolean {
    return handleVisualLineKeyDown(state, view, event, pagesContainer.value);
  }

  return {
    state,
    getCaretClientX,
    findLineElementAtPosition,
    findPositionOnLineAtClientX,
    handlePMKeyDown,
  };
}

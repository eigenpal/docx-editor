import type { Editor } from '../contracts/editor.ts';
import { leaveScopeForBodyParagraph } from './docx-editor-story-navigation.ts';
import type { PaginatedSurface } from './paginated-surface-contract.ts';

/** Shared browser navigation for the editor and its adapters. Anchors: `docx-editor-anchor-navigation.ts`. */
export function createEditorScrolling(
  getSurface: () => PaginatedSurface | null,
  flushOpen: () => void
): Pick<Editor, 'scrollToPage' | 'scrollToBlock'> {
  return {
    scrollToPage(pageNumber) {
      if (!Number.isInteger(pageNumber) || pageNumber < 1) return false;
      // Mount a pending document before resolving its page number.
      flushOpen();
      return getSurface()?.revealPage(pageNumber - 1) ?? false;
    },
    scrollToBlock(blockId) {
      if (typeof blockId !== 'string' || blockId.length === 0) return false;
      flushOpen();
      const surface = getSurface();
      // Preserve the existing block navigation behavior when leaving a note or header.
      if (surface) leaveScopeForBodyParagraph(surface, blockId);
      return surface?.revealParagraph(blockId) ?? false;
    },
  };
}

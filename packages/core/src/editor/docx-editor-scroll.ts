import type { Editor } from '../contracts/editor.ts';
import { leaveScopeForBodyParagraph } from './docx-editor-story-navigation.ts';
import type { PaginatedSurface } from './paginated-surface-contract.ts';

const REVEAL_BLOCKS: ReadonlySet<string> = new Set([
  'start',
  'center',
  'centerIfNeeded',
  'nearest',
]);

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
    scrollToBlock(blockId, options) {
      if (typeof blockId !== 'string' || blockId.length === 0) return false;
      // An unknown placement is refused, not read as the default.
      const block = options?.block;
      if (block !== undefined && !REVEAL_BLOCKS.has(block)) return false;
      flushOpen();
      const surface = getSurface();
      // Preserve the existing block navigation behavior when leaving a note or header.
      if (surface) leaveScopeForBodyParagraph(surface, blockId);
      return surface?.revealParagraph(blockId, block ? { block } : undefined) ?? false;
    },
  };
}

import type { Editor } from '../contracts/editor.ts';
import { isDocAnchor, resolveDocAnchor } from './anchor-resolution.ts';
import { leaveScopeForBodyParagraph } from './docx-editor-story-navigation.ts';
import type { PaginatedSurface } from './paginated-surface-contract.ts';

/** Shared browser navigation for the editor and its adapters. */
export function createEditorScrolling(
  getSurface: () => PaginatedSurface | null,
  flushOpen: () => void
): Pick<Editor, 'scrollToPage' | 'scrollToBlock' | 'scrollToAnchor'> {
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
    scrollToAnchor(anchor) {
      if (!isDocAnchor(anchor)) return false;
      flushOpen();
      const surface = getSurface();
      if (!surface) return false;
      // Session reads sit below the input buffer. Resolve against committed text.
      surface.flushPendingInput();
      const resolved = resolveDocAnchor(
        surface.session.part(),
        surface.session.paragraphAnchors(),
        anchor
      );
      if (!resolved.ok) return false;
      // Reveal directly: selecting or entering a story would move the caller's caret.
      return surface.revealPosition(
        { paragraphId: resolved.span.nodeId, offset: resolved.span.start },
        { block: 'centerIfNeeded' }
      );
    },
  };
}

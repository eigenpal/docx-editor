// Paragraph text for hosts: the engine half of `Editor.getParagraphText()` and
// `Editor.getPaintedParagraphs()`.
//
// Text comes from `paragraphTextOf`, the reader that text highlights check ranges against, so a
// range a host computes from it resolves when the host sets it. The painted paragraphs come from
// the frame the surface last painted, the same pages that highlights paint on.

import { findNode, paragraphOffsetIndex, paragraphTextOf } from '@docx-editor.dev/core/store';
import type {
  EditorParagraphText,
  ParagraphText,
  TextSpan,
} from '../contracts/editor-paragraph-text.ts';
import { pagePlacedIds } from '../layout/paragraph-range-rects.ts';
import type { OoxmlNode, OoxmlParagraphNode } from '../store/package/ooxml-tree.ts';
import type { PaginatedSurface } from './paginated-surface-contract.ts';
import type { SurfaceOverlayFrame } from './surface-overlay-sheet.ts';
import { partOfNodeId } from './surface-scope.ts';

function deletionsOf(paragraph: OoxmlParagraphNode): TextSpan[] {
  const index = paragraphOffsetIndex(paragraph);
  const deletions: TextSpan[] = [];
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'revisionDelete' || node.kind === 'revisionMoveFrom') {
      const span = index.spanOf(node);
      if (span && span.end > span.start) {
        deletions.push({ start: span.start, length: span.end - span.start });
      }
      return;
    }
    if ('children' in node) for (const child of node.children) visit(child);
  };
  for (const child of paragraph.children) visit(child);
  return deletions;
}

function readParagraph(surface: PaginatedSurface, blockId: string): ParagraphText | null {
  const part = partOfNodeId(surface.session, blockId);
  const paragraph = part ? findNode(part, blockId) : null;
  if (!part || paragraph?.kind !== 'paragraph') return null;
  const text = paragraphTextOf(part, blockId);
  return text === null ? null : { blockId, text, deletions: deletionsOf(paragraph) };
}

export function createParagraphTextReads(deps: {
  surface(): PaginatedSurface | null;
  /** The frame the surface last painted, or null before the first paint. */
  frame(): SurfaceOverlayFrame | null;
}): EditorParagraphText {
  return {
    getParagraphText(blockId) {
      const surface = deps.surface();
      return surface ? readParagraph(surface, blockId) : null;
    },
    getPaintedParagraphs() {
      const surface = deps.surface();
      const frame = deps.frame();
      if (!surface || !frame) return [];
      const ids = new Set<string>();
      for (const page of frame.layout.pages) {
        if (frame.pages && !frame.pages.has(page.index)) continue;
        for (const id of pagePlacedIds(page)) ids.add(id);
      }
      return [...ids].flatMap((id) => readParagraph(surface, id) ?? []);
    },
  };
}

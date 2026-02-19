import type { Node as PMNode } from 'prosemirror-model';

/**
 * Information about a heading found in the document.
 */
export interface HeadingInfo {
  /** The text content of the heading */
  text: string;
  /** Outline level (0 = Heading 1, 1 = Heading 2, etc.) */
  level: number;
  /** ProseMirror document position of the paragraph node */
  pmPos: number;
}

/**
 * Collect all headings from a ProseMirror document.
 *
 * Detection logic:
 * 1. Check `outlineLevel` attr (set by OOXML parsing or style resolution)
 * 2. Fallback to `styleId` matching /^[Hh]eading(\d)$/
 */
export function collectHeadings(doc: PMNode): HeadingInfo[] {
  const headings: HeadingInfo[] = [];

  doc.descendants((node, pos) => {
    if (node.type.name === 'paragraph') {
      const level = node.attrs.outlineLevel;
      const styleId = node.attrs.styleId as string | null;

      let effectiveLevel = level;
      if (effectiveLevel == null && styleId) {
        const match = styleId.match(/^[Hh]eading(\d)$/);
        if (match) effectiveLevel = parseInt(match[1], 10) - 1;
      }

      if (effectiveLevel != null && effectiveLevel >= 0 && effectiveLevel <= 8) {
        let text = '';
        node.forEach((child) => {
          if (child.isText) text += child.text || '';
        });
        if (text.trim()) {
          headings.push({ text: text.trim(), level: effectiveLevel, pmPos: pos });
        }
      }
    }
  });

  return headings;
}

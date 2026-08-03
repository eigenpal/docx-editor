// Which paragraphs a tracked revision removes from the laid-out document.
//
// A `w:del` on the paragraph MARK (17.13.5.15, `w:pPr/w:rPr/w:del`) says the mark itself was
// deleted, which in Word joins the paragraph to the one after it. When everything the
// paragraph would have rendered is deleted too, that join leaves nothing at all — Word shows
// no line where the paragraph was.
//
// Layout does not render deleted run content (a `w:del` is not a run container it walks, and
// `w:delText` is not model text), so such a paragraph reaches pagination with no spans and
// still claims a full line box. A cell of them is a stack of blank lines that pushes real
// content down the page and off it. This module identifies exactly that case.
//
// The narrow condition matters. A paragraph whose CONTENT is deleted but whose mark survives
// is a paragraph Word still shows as empty, and suppressing it would delete a blank line the
// document really has. A paragraph whose mark is deleted but which still renders something
// has to keep its box, because that content is visible and Word merely merges it forward —
// dropping it would lose text. Only the intersection is removed.

import type { OoxmlNode } from '@docx-editor.dev/core-contract/store';

/** Matches the layout walk's own container recursion; see `piecesOfParagraph`. */
const MAX_INLINE_DEPTH = 8;

function childNamed(node: OoxmlNode, localName: string): OoxmlNode | undefined {
  if (node.kind === 'textValue') return undefined;
  for (const child of node.children) {
    if (child.kind !== 'textValue' && child.localName === localName) return child;
  }
  return undefined;
}

/**
 * `w:pPr/w:rPr/w:del` — the paragraph mark was deleted by a tracked revision.
 *
 * Read from the paragraph-mark run properties only. A `w:del` anywhere else in the paragraph
 * deletes run content, which is a different statement entirely.
 */
export function paragraphMarkDeleted(paragraph: OoxmlNode): boolean {
  if (paragraph.kind === 'textValue') return false;
  const properties = childNamed(paragraph, 'paragraphProperties') ?? childNamed(paragraph, 'pPr');
  if (!properties) return false;
  const markRunProperties =
    childNamed(properties, 'runProperties') ?? childNamed(properties, 'rPr');
  return markRunProperties !== undefined && childNamed(markRunProperties, 'del') !== undefined;
}

/**
 * Whether the paragraph would put any text on the page.
 *
 * Deliberately mirrors the container recursion layout itself performs: typed runs and the
 * runs inside a `w:hyperlink` contribute, and any other container (including `w:del` and
 * `w:ins`) does not. If that recursion ever changes, this must change with it or a paragraph
 * that now renders could be suppressed.
 */
function rendersNoText(node: OoxmlNode, depth: number): boolean {
  if (node.kind === 'textValue') return true;
  if (depth > MAX_INLINE_DEPTH) return true;
  for (const child of node.children) {
    if (child.kind === 'textValue') continue;
    if (child.kind === 'run') {
      for (const grand of child.children) {
        if (grand.kind === 'text') {
          for (const value of grand.children) {
            if (value.kind === 'textValue' && value.value.length > 0) return false;
          }
          continue;
        }
        // A tab, a break, or a drawing all occupy the line even with no characters. Anything
        // unrecognised counts as rendering too: keeping a paragraph that renders nothing
        // costs a blank line, dropping one that renders something loses content.
        if (grand.kind !== 'runProperties') return false;
      }
      continue;
    }
    if (child.kind === 'hyperlink' && !rendersNoText(child, depth + 1)) return false;
  }
  return true;
}

/**
 * True when a tracked revision has removed this paragraph from the rendered document, so
 * layout should emit no box for it at all.
 */
export function revisionRemovesParagraph(paragraph: OoxmlNode): boolean {
  if (paragraph.kind !== 'paragraph') return false;
  if (!paragraphMarkDeleted(paragraph)) return false;
  return rendersNoText(paragraph, 0);
}

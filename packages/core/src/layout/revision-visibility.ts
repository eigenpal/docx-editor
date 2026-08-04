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
import {
  contentControlContentOf,
  isContentControl,
  MAX_CONTENT_CONTROL_NESTING,
} from '../store/package/content-control-walk.ts';
import { MAX_REVISION_DEPTH } from './revision-projection.ts';

/**
 * Matches the layout walk's own container recursion; see `piecesOfParagraph`.
 *
 * Taken FROM that walk rather than restated. At a local 8 against layout's 32, a paragraph
 * nested past 8 was called empty here while layout still emitted its spans — so file-
 * controlled nesting, which costs an attacker nothing, dropped visible text from the page.
 */
const MAX_INLINE_DEPTH = MAX_REVISION_DEPTH;

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
 * Judged in the view this suppression MODELS: the one where the mark deletion has been
 * accepted and the paragraph joined the next. There, deleted content is gone and inserted
 * content stays, so `w:del` and `w:moveFrom` render nothing while `w:ins` and `w:moveTo` are
 * descended into like any other run container — as is `w:hyperlink`, and either can hold the
 * other. Inline content controls flatten the same way layout does.
 *
 * Not mode-parameterised on purpose. `storyBlocks` is indexed by section addressing, so a
 * block list that changed shape with the display mode would move section boundaries under it.
 *
 * Descending into insertions is load-bearing: a paragraph whose mark is struck and whose
 * content is an insertion is Word's shape for "this line was added, then merged upward", and
 * treating its content as unrendered dropped the added words from every mode.
 */
function rendersNoText(node: OoxmlNode, depth: number): boolean {
  if (node.kind === 'textValue') return true;
  if (depth > MAX_INLINE_DEPTH) return true;
  const walkChildren = (children: readonly OoxmlNode[], childDepth: number): boolean => {
    for (const child of children) {
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
      if (isContentControl(child)) {
        if (childDepth >= MAX_CONTENT_CONTROL_NESTING) continue;
        const content = contentControlContentOf(child);
        if (content && !walkChildren(content, childDepth + 1)) return false;
        continue;
      }
      const descends =
        child.kind === 'hyperlink' ||
        child.kind === 'revisionInsert' ||
        child.kind === 'revisionMoveTo';
      if (descends && !rendersNoText(child, childDepth + 1)) return false;
    }
    return true;
  };
  return walkChildren(node.children, depth);
}

/**
 * True when a tracked revision has removed this paragraph from the rendered document, so
 * layout should emit no box for it at all.
 */
export function revisionRemovesParagraph(
  paragraph: OoxmlNode,
  displayMode: 'all-markup' | 'proposed' | 'original' = 'proposed'
): boolean {
  if (paragraph.kind !== 'paragraph') return false;
  // ORIGINAL rejects every revision, so the mark deletion is rejected too and the paragraph
  // stays — with the words its `w:del` was hiding. ALL-MARKUP shows the deletion struck
  // through, which is also a line. Only the PROPOSED result actually performs the join, and
  // it is the only view this suppression describes.
  if (displayMode !== 'proposed') return false;
  if (!paragraphMarkDeleted(paragraph)) return false;
  return rendersNoText(paragraph, 0);
}

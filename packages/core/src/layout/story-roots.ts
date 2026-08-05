// Story roots over the canonical tree (phase 2 of the legacy-lane retirement).
//
// A STORY is a flowable sequence of blocks: the body of the main document, the whole
// content of a header/footer part (`w:hdr`/`w:ftr` roots hold block content directly),
// or a single footnote/endnote node. This is the single place that knows which roots
// flow and how block-level content controls flatten — via shared `collectFlowBlocks`.
//
// SDT content flattens TRANSPARENTLY: the paragraphs and tables inside `w:sdtContent`
// join the flow in reading order (Word renders them in place), while the `w:sdt` wrapper
// itself stays structurally preserved for serialization. SDT chrome — placeholder text,
// locks, dropdown behaviour — is not modelled here.
//
// Note parts (`w:footnotes` / `w:endnotes`) are NOT story roots: each typed `w:footnote` /
// `w:endnote` child is its own story via {@link noteStoryBlocks}.

import type { OoxmlElement, OoxmlNode, OoxmlPart } from '@docx-editor.dev/core/store';
import { collectFlowBlocks } from '../store/package/content-control-walk.ts';
import type { RevisionDisplayMode } from './revision-projection.ts';
import { revisionRemovesParagraph } from './revision-visibility.ts';

export { MAX_CONTENT_CONTROL_NESTING as MAX_SDT_NESTING } from '../store/package/content-control-walk.ts';

/** Roots whose children are block content: the body, and header/footer part roots. */
function storyRootOf(part: OoxmlPart): OoxmlElement | undefined {
  const root = part.root;
  if (root.localName === 'hdr' || root.localName === 'ftr') return root;
  const findBody = (node: OoxmlNode): OoxmlElement | undefined => {
    if (node.kind === 'textValue') return undefined;
    if (node.kind === 'body') return node;
    for (const child of node.children) {
      const found = findBody(child);
      if (found) return found;
    }
    return undefined;
  };
  return findBody(root);
}

function acceptStoryBlock(block: OoxmlElement, displayMode: RevisionDisplayMode): boolean {
  // A paragraph whose mark AND content a tracked revision deleted is not part of the
  // rendered document; without this it reaches pagination with no spans and still
  // claims a full line box.
  if (block.kind === 'paragraph' && revisionRemovesParagraph(block, displayMode)) return false;
  return true;
}

/**
 * The story's blocks — paragraphs and tables — in document order, flattening through
 * block-level content-control wrappers under the shared nesting budget.
 */
export function storyBlocks(
  part: OoxmlPart,
  displayMode: RevisionDisplayMode = 'all-markup'
): OoxmlElement[] {
  const root = storyRootOf(part);
  if (!root) return [];
  return collectFlowBlocks(root.children, 0, (block) => acceptStoryBlock(block, displayMode));
}

/**
 * Blocks of one typed footnote/endnote node — a separate semantic story root.
 *
 * The footnotes/endnotes part root is never a story; each note is laid out independently
 * so line ids and incremental convergence stay namespaced by note identity.
 */
export function noteStoryBlocks(
  note: OoxmlNode,
  displayMode: RevisionDisplayMode = 'all-markup'
): OoxmlElement[] {
  if (note.kind !== 'note') return [];
  return collectFlowBlocks(note.children, 0, (block) => acceptStoryBlock(block, displayMode));
}

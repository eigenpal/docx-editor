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
import { createRecentRootCache } from '../store/store/recent-root-cache.ts';
import type { RevisionDisplayMode } from './revision-projection.ts';
import { markRemovedInMode, revisionRemovesParagraph } from './revision-visibility.ts';

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
 * The paragraphs a merge group is built from, in order, with the survivor last.
 *
 * Published beside the synthetic paragraph rather than derived from it, because the identity
 * rewrite has to name the member a piece of content came from and a synthetic node has lost
 * that by construction.
 */
export interface ParagraphMergeGroup {
  /** The node layout lays out: the survivor's properties, every member's content. */
  readonly merged: OoxmlElement;
  /** Members in document order. The last one is the survivor whose mark stays. */
  readonly members: readonly OoxmlElement[];
}

/** Groups keyed by the synthetic node, so a caller holding one can ask what it came from. */
const mergeGroups = new WeakMap<OoxmlElement, ParagraphMergeGroup>();

/** The members a laid-out paragraph stands for, or null when it stands for itself. */
export function paragraphMergeGroupOf(paragraph: OoxmlElement): ParagraphMergeGroup | null {
  return mergeGroups.get(paragraph) ?? null;
}

function isParagraphProperties(node: OoxmlNode): boolean {
  return (
    node.kind !== 'textValue' && (node.kind === 'paragraphProperties' || node.localName === 'pPr')
  );
}

/**
 * Fold each run of mark-removed paragraphs into the paragraph that follows it.
 *
 * The shape matches `resolveRevisions` exactly: the SURVIVOR's `w:pPr` governs, and every
 * member's content arrives before it in document order. A trailing member with nothing to
 * merge into keeps itself, for the same reason the store refuses that case — its runs have no
 * paragraph to live in.
 */
function withMergedParagraphs(
  blocks: readonly OoxmlElement[],
  displayMode: RevisionDisplayMode
): OoxmlElement[] {
  if (displayMode === 'all-markup') return [...blocks];
  const out: OoxmlElement[] = [];
  let pendingMembers: OoxmlElement[] = [];
  for (const block of blocks) {
    if (block.kind !== 'paragraph') {
      // A table between two mark-removed paragraphs is a container boundary: the store cannot
      // merge across it either, so the run of members ends here and keeps its own boxes.
      out.push(...pendingMembers, block);
      pendingMembers = [];
      continue;
    }
    if (markRemovedInMode(block, displayMode)) {
      pendingMembers.push(block);
      continue;
    }
    if (pendingMembers.length === 0) {
      out.push(block);
      continue;
    }
    const members = [...pendingMembers, block];
    pendingMembers = [];
    const survivorProperties = block.children.filter((child) => isParagraphProperties(child));
    const content = members.flatMap((member) =>
      member.children.filter((child) => !isParagraphProperties(child))
    );
    const merged: OoxmlElement = {
      ...block,
      children: [...survivorProperties, ...content],
    } as OoxmlElement;
    mergeGroups.set(merged, { merged, members });
    out.push(merged);
  }
  // Members with no survivor after them: the last paragraph of the story carries its own mark
  // away, which is what Word does when there is nothing to run into.
  out.push(...pendingMembers);
  return out;
}

/**
 * Memoized per part identity: parts are immutable (edits publish a new part object), so
 * the block list is a pure function of `(part, displayMode)`. Every keystroke flush asks
 * for the body's blocks from several callers — layout, section enumeration, furniture,
 * note pagination — and this walk ran fresh for each of them. A bounded WeakRef ring
 * rather than a plain WeakMap because undo history retains package snapshots by
 * reference; 16 slots cover one flush's parts (body + header/footer variants + notes).
 * Callers treat the result as read-only, so a shared array is safe to hand out.
 */
const storyBlocksCache =
  createRecentRootCache<Partial<Record<RevisionDisplayMode, OoxmlElement[]>>>(16);

/**
 * The story's blocks — paragraphs and tables — in document order, flattening through
 * block-level content-control wrappers under the shared nesting budget.
 *
 * Repeated calls with the same part and display mode return the SAME array instance,
 * shared by every caller — treat it as read-only; mutating it corrupts later callers.
 */
export function storyBlocks(
  part: OoxmlPart,
  displayMode: RevisionDisplayMode = 'all-markup'
): OoxmlElement[] {
  const perMode = storyBlocksCache.get(part);
  const cached = perMode?.[displayMode];
  if (cached) return cached;
  const root = storyRootOf(part);
  // MERGE FIRST, then drop. A mark-removed paragraph merges into the paragraph that follows it
  // IN THE TREE, which is the rule `resolveRevisions` follows; dropping the empty ones first
  // would hand a member the wrong survivor, and the survivor's properties govern the result.
  // After the merge the drop has little left to do: an absorbed member is already gone, and
  // what remains is a mark-removed paragraph with nothing after it to merge into.
  const merged = withMergedParagraphs(
    root ? collectFlowBlocks(root.children, 0, () => true) : [],
    displayMode
  );
  const blocks = merged.filter((block) => acceptStoryBlock(block, displayMode));
  if (perMode) perMode[displayMode] = blocks;
  else storyBlocksCache.set(part, { [displayMode]: blocks });
  return blocks;
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

/**
 * Blocks of one `w:txbxContent` node — the story inside a text-box drawing.
 *
 * Like a note, a textbox is its own story root laid out independently of the part that
 * hosts the drawing, so line ids and incremental convergence stay namespaced by drawing
 * identity.
 */
export function textboxStoryBlocks(
  content: OoxmlNode,
  displayMode: RevisionDisplayMode = 'all-markup'
): OoxmlElement[] {
  if (content.kind === 'textValue') return [];
  return collectFlowBlocks(content.children, 0, (block) => acceptStoryBlock(block, displayMode));
}

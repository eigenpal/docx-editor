// Which section a caret is in, for a caret in any story.
//
// Sections are a BODY structure: `w:sectPr` lives in the body flow and nowhere else, so a
// paragraph in a header, a footer or a note is in no section map at all. Answering `0` — or the
// tail section, the other easy wrong answer — is not merely a display error, because the reads
// that ask this question feed writes: the ruler's clamps, the grid width `insertTableOp` sizes
// from, and the `w:sectPr` the note-properties dialog writes back to. Three callers each
// guessed differently, so the answer lives here once.

import type { TreeDocxSessionView } from '@docx-editor.dev/core/binding';
import type { StoryScope } from '@docx-editor.dev/core/store';
import { enumerateDocumentSections } from '../layout/section-properties.ts';
import { storyBlocks } from '../layout/story-roots.ts';
import { collectNoteReferences, resolveNotesPart } from '../store/package/note-references.ts';
import { noteIdOf, notesOf } from '../store/package/note-nodes.ts';
import type { OoxmlNode } from '../store/package/ooxml-tree.ts';

/** Depth cap for the note-body walk, matching the shared tree-walk bound. */
const MAX_NOTE_WALK_DEPTH = 32;

/**
 * The section a paragraph belongs to, whichever story it is in.
 *
 * A body paragraph answers directly. A header or footer belongs to the section that names its
 * relationship — the OPEN one when the surface knows it, because inheritance lets several
 * sections share one header and the first to name it is not the page the reader is looking at.
 * A note belongs to the section holding its reference mark, which is a body paragraph.
 *
 * Returns `0` when nothing settles it, which is the first section rather than the tail: the
 * tail is the document-wide answer and is wrong for everything not on the last page.
 */
export function sectionIndexForCaret(
  session: TreeDocxSessionView,
  paragraphId: string,
  scope: StoryScope,
  openHeaderFooterSection?: number
): number {
  const part = session.part();
  const sections = enumerateDocumentSections(part);
  if (sections.length <= 1) return 0;

  // BODY content answers for itself, whatever story happens to be open. Consulting the open
  // scope first made `sectionPropertiesAt(id)` ignore its own argument for the whole time a
  // header was open, so every body paragraph reported the header's section.
  const bodyIndex = bodySectionIndexOf(session, paragraphId);
  if (bodyIndex !== null) return bodyIndex;

  if (scope.kind === 'headerFooter') {
    if (openHeaderFooterSection !== undefined && sections[openHeaderFooterSection] !== undefined) {
      return openHeaderFooterSection;
    }
    const owning = session
      .headerFooterResolutionBySection()
      .findIndex((section) =>
        [section.headers, section.footers].some((slots) =>
          [...slots.values()].some((slot) => slot.rId === scope.rId)
        )
      );
    return owning === -1 ? 0 : owning;
  }

  const referencing = referencingBodyParagraph(session, paragraphId);
  if (referencing !== null) {
    const viaReference = bodySectionIndexOf(session, referencing);
    if (viaReference !== null) return viaReference;
  }
  return 0;
}

/**
 * A BODY paragraph in the same section as `paragraphId`, for an op that addresses a section by
 * anchor and can only name body content.
 *
 * `null` when the document has one section, where every anchor names the same thing and the
 * caller should pass none.
 */
export function sectionAnchorParagraphFor(
  session: TreeDocxSessionView,
  paragraphId: string,
  scope: StoryScope,
  openHeaderFooterSection?: number
): string | null {
  const part = session.part();
  const sections = enumerateDocumentSections(part);
  if (sections.length <= 1) return null;
  const own = bodySectionIndexOf(session, paragraphId);
  if (own !== null) return paragraphId;

  const index = sectionIndexForCaret(session, paragraphId, scope, openHeaderFooterSection);
  const section = sections[index];
  if (!section) return null;
  const blocks = storyBlocks(part);
  for (let i = section.blockStart; i < section.blockEndExclusive; i += 1) {
    const found = firstParagraphIn(blocks[i]);
    if (found !== null) return found;
  }
  // A section holding no paragraph at all has NO anchor, and inventing one is worse than
  // having none. `targetSectionNodes` resolves an anchor to the first `w:sectPr` at or after
  // it, so any paragraph borrowed from elsewhere pins the write to THAT paragraph's section —
  // section 0, for the obvious "first paragraph in the body" choice. An omitted anchor writes
  // every section, which is broader than asked but does include the one the caller means; a
  // borrowed anchor writes one section and it is the wrong one.
  //
  // Not exotic: a trailing body-level `w:sectPr` is minted as an empty final section, which is
  // ordinary in a multi-section package — and its header is one a reader stands in.
  return null;
}

/** The first paragraph id anywhere under a block, tables and controls included. */
function firstParagraphIn(block: OoxmlNode | undefined): string | null {
  if (!block) return null;
  const walk = (node: OoxmlNode, depth: number): string | null => {
    if (node.kind === 'textValue' || depth > MAX_NOTE_WALK_DEPTH) return null;
    if (node.kind === 'paragraph') return node.id;
    for (const child of node.children) {
      const found = walk(child, depth + 1);
      if (found !== null) return found;
    }
    return null;
  };
  return walk(block, 0);
}

/** The section index of a BODY paragraph, or `null` when the body does not hold it. */
export function bodySectionIndexOf(
  session: TreeDocxSessionView,
  paragraphId: string
): number | null {
  const part = session.part();
  // Node ids are part-qualified, so a paragraph from another story is answerable in constant
  // time. Without this the walk below ran the whole body before returning `null` — and it sits
  // on the `snapshot()` path, so a furniture caret paid a full-document scan per keystroke.
  if (!paragraphId.startsWith(`${part.name}#`)) return null;
  const sections = enumerateDocumentSections(part);
  const blocks = storyBlocks(part);
  for (let index = 0; index < sections.length; index += 1) {
    const section = sections[index]!;
    for (let i = section.blockStart; i < section.blockEndExclusive; i += 1) {
      const block = blocks[i];
      if (block && holdsParagraph(block, paragraphId)) return index;
    }
  }
  return null;
}

/**
 * The body paragraph whose `w:footnoteReference` / `w:endnoteReference` cites the note that
 * holds `paragraphId`, or `null` when the id is not note content or nothing cites it.
 *
 * An orphaned note — one no reference points at — legitimately answers `null`. Word treats it
 * as unreachable content, and guessing a section for it would be inventing one.
 */
export function referencingBodyParagraph(
  session: TreeDocxSessionView,
  paragraphId: string
): string | null {
  const pkg = session.currentPackage();
  for (const noteKind of ['footnote', 'endnote'] as const) {
    const notesPart = resolveNotesPart(pkg, noteKind);
    if (!notesPart || !paragraphId.startsWith(`${notesPart.name}#`)) continue;
    for (const note of notesOf(notesPart.root)) {
      const noteId = noteIdOf(note);
      if (noteId === null || !holdsParagraph(note, paragraphId)) continue;
      const hit = collectNoteReferences(session.part()).find(
        (candidate) => candidate.noteKind === noteKind && candidate.noteId === noteId
      );
      return hit?.paragraphId ?? null;
    }
  }
  return null;
}

/** Whether a subtree contains this paragraph id, within the shared depth cap. */
function holdsParagraph(root: OoxmlNode, paragraphId: string): boolean {
  const walk = (node: OoxmlNode, depth: number): boolean => {
    if (node.kind === 'textValue' || depth > MAX_NOTE_WALK_DEPTH) return false;
    if (node.kind === 'paragraph' && node.id === paragraphId) return true;
    for (const child of node.children) if (walk(child, depth + 1)) return true;
    return false;
  };
  return walk(root, 0);
}

// Read-only note-property state for adapter chrome — no tree mutation.

import type { TreeDocxSessionView } from '@docx-editor.dev/core/binding';
import {
  bodySectionNode,
  enumerateDocumentSections,
  paragraphSectionNode,
} from '../layout/section-properties.ts';
import { storyBlocks } from '../layout/story-roots.ts';
import {
  authoredDocumentEndnoteProperties,
  authoredDocumentFootnoteProperties,
  authoredEndnotePropertiesFromSectPr,
  authoredFootnotePropertiesFromSectPr,
  resolveEndnoteProperties,
  resolveFootnoteProperties,
  settingsPartOf,
  type AuthoredNoteProperties,
  type ResolvedEndnoteProperties,
  type ResolvedFootnoteProperties,
} from '../store/package/note-properties.ts';
import {
  isNormalNote,
  noteIdOf,
  notesOf,
  parseNoteScopeId,
  findNoteById,
  type NoteKind,
} from '../store/package/note-nodes.ts';
import { collectNoteReferences, resolveNotesPart } from '../store/package/note-references.ts';
import { paragraphTextOf } from '@docx-editor.dev/core/store';
import type { OoxmlElement, OoxmlNode, OoxmlPart } from '../store/package/ooxml-tree.ts';
import type { PaginatedSurface } from './paginated-surface-contract.ts';

export type NotePropertiesSlice = {
  readonly resolved: ResolvedFootnoteProperties | ResolvedEndnoteProperties;
  readonly documentAuthored?: AuthoredNoteProperties;
  readonly sectionAuthored?: AuthoredNoteProperties;
};

export type NotePropertiesStateSnapshot = {
  readonly sectionIndex: number;
  readonly footnote: NotePropertiesSlice;
  readonly endnote: NotePropertiesSlice;
};

/** Hard cap for attacker-controlled note text exposed to hover chrome. */
export const MAX_NOTE_PREVIEW_CHARS = 500;

/**
 * Which section a paragraph belongs to, for any story the caret can be in.
 *
 * Sections are a BODY structure — `w:sectPr` lives in the body flow and nowhere else — so the
 * map below can only ever hold body paragraph ids. A caret in a note or a header therefore
 * misses it, and the old `?? 0` answered "section 0" for every one of them. That answer is not
 * merely displayed: the note-properties dialog writes back to the section it reports, so a
 * footnote in section 3 silently rewrote section 0's `w:sectPr`. Read and write agreed with
 * each other and were both wrong, which is why it produced no symptom.
 *
 * A note belongs to the section holding its REFERENCE mark, which is a body paragraph. A header
 * belongs to the section that names its relationship, which the open scope already knows.
 */
function paragraphSectionIndexOf(
  session: TreeDocxSessionView,
  paragraphId: string,
  openSectionIndex?: number
): number {
  const part = session.part();
  const sections = enumerateDocumentSections(part);
  const blocks = storyBlocks(part);
  const map = new Map<string, number>();
  for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex += 1) {
    const section = sections[sectionIndex]!;
    for (let i = section.blockStart; i < section.blockEndExclusive; i += 1) {
      const block = blocks[i];
      if (!block) continue;
      if (block.kind === 'paragraph') {
        map.set(block.id, sectionIndex);
        continue;
      }
      const walk = (
        node: { kind: string; id?: string; children?: readonly unknown[] },
        depth: number
      ): void => {
        if (depth > 32) return;
        if (node.kind === 'paragraph' && typeof node.id === 'string') {
          map.set(node.id, sectionIndex);
          return;
        }
        for (const child of node.children ?? []) {
          walk(child as { kind: string; id?: string; children?: readonly unknown[] }, depth + 1);
        }
      };
      walk(block, 0);
    }
  }
  const own = map.get(paragraphId);
  if (own !== undefined) return own;

  // A header or footer: the open scope carries the section that names its relationship.
  if (openSectionIndex !== undefined && openSectionIndex < sections.length) return openSectionIndex;

  // A note: follow it back to the body paragraph that cites it.
  const referencing = referencingBodyParagraph(session, paragraphId, part);
  if (referencing !== null) {
    const viaReference = map.get(referencing);
    if (viaReference !== undefined) return viaReference;
  }
  return 0;
}

/**
 * The body paragraph whose `w:footnoteReference` / `w:endnoteReference` cites the note that
 * holds `paragraphId`, or `null` when the id is not note content or nothing cites it.
 *
 * An orphaned note — one no reference points at — legitimately answers `null`. Word treats it
 * as unreachable content, and guessing a section for it would be inventing one.
 */
function referencingBodyParagraph(
  session: TreeDocxSessionView,
  paragraphId: string,
  bodyPart: OoxmlPart
): string | null {
  const pkg = session.currentPackage();
  for (const noteKind of ['footnote', 'endnote'] as const) {
    const notesPart = resolveNotesPart(pkg, noteKind);
    if (!notesPart || !paragraphId.startsWith(`${notesPart.name}#`)) continue;
    for (const note of notesOf(notesPart.root)) {
      const noteId = noteIdOf(note);
      if (noteId === null || !holdsParagraph(note, paragraphId)) continue;
      const hit = collectNoteReferences(bodyPart).find(
        (candidate) => candidate.noteKind === noteKind && candidate.noteId === noteId
      );
      return hit?.paragraphId ?? null;
    }
  }
  return null;
}

/** Whether a note body contains this paragraph id, within the shared depth cap. */
function holdsParagraph(note: OoxmlNode, paragraphId: string): boolean {
  const walk = (node: OoxmlNode, depth: number): boolean => {
    if (node.kind === 'textValue' || depth > 32) return false;
    if (node.kind === 'paragraph' && node.id === paragraphId) return true;
    for (const child of node.children) if (walk(child, depth + 1)) return true;
    return false;
  };
  return walk(note, 0);
}

function sectionSectPrNodes(
  session: TreeDocxSessionView,
  sections: ReturnType<typeof enumerateDocumentSections>
): readonly (import('../store/package/ooxml-tree.ts').OoxmlElement | undefined)[] {
  const part = session.part();
  const blocks = storyBlocks(part);
  const nodes: (import('../store/package/ooxml-tree.ts').OoxmlElement | undefined)[] = [];
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index]!;
    if (block.kind !== 'paragraph') continue;
    const sectPr = paragraphSectionNode(block);
    if (!sectPr) continue;
    nodes.push(sectPr);
  }
  // The FINAL section is closed by the body-level `w:sectPr`, not by a paragraph mark, so it
  // has no entry in the walk above. Padding it with `undefined` made the dialog report document
  // defaults for the last section of every document — and in a single-section file that is the
  // only section there is, so its `w:footnotePr` was never read at all.
  if (nodes.length < sections.length) {
    const body = bodySectionNode(session.part());
    nodes.push(body && body.kind !== 'textValue' ? (body as OoxmlElement) : undefined);
  }
  while (nodes.length < sections.length) nodes.push(undefined);
  return nodes;
}

export function notePropertiesStateOf(
  surface: PaginatedSurface | null
): NotePropertiesStateSnapshot | null {
  if (!surface) return null;
  const session = surface.session;
  const paragraphId = surface.state().selection.head.paragraphId;
  const sectionIndex = paragraphSectionIndexOf(
    session,
    paragraphId,
    surface.headerFooterState()?.sectionIndex
  );
  const pkg = session.currentPackage();
  const settings = settingsPartOf(pkg);
  const docFnAuthored = authoredDocumentFootnoteProperties(settings);
  const docEnAuthored = authoredDocumentEndnoteProperties(settings);
  const sections = enumerateDocumentSections(session.part());
  const sectPrBySection = sectionSectPrNodes(session, sections);
  const sectionFnAuthored = authoredFootnotePropertiesFromSectPr(sectPrBySection[sectionIndex]);
  const sectionEnAuthored = authoredEndnotePropertiesFromSectPr(sectPrBySection[sectionIndex]);

  const footnoteResolved = resolveFootnoteProperties(sectionFnAuthored, docFnAuthored);
  const endnoteResolved = resolveEndnoteProperties(sectionEnAuthored, docEnAuthored);

  return {
    sectionIndex,
    footnote: {
      resolved: footnoteResolved,
      ...(docFnAuthored ? { documentAuthored: docFnAuthored } : {}),
      ...(sectionFnAuthored ? { sectionAuthored: sectionFnAuthored } : {}),
    },
    endnote: {
      resolved: endnoteResolved,
      ...(docEnAuthored ? { documentAuthored: docEnAuthored } : {}),
      ...(sectionEnAuthored ? { sectionAuthored: sectionEnAuthored } : {}),
    },
  };
}

export function listNormalNoteIds(
  session: TreeDocxSessionView,
  noteKind: NoteKind
): readonly number[] {
  const part = resolveNotesPart(session.currentPackage(), noteKind);
  if (!part) return [];
  return notesOf(part.root)
    .filter((note) => isNormalNote(note))
    .map((note) => noteIdOf(note))
    .filter((id): id is number => id !== null);
}

/** Plain text preview for a note scope id — safe for tooltip display. */
export function notePreviewTextOf(session: TreeDocxSessionView, scopeId: string): string | null {
  const parsed = parseNoteScopeId(scopeId);
  if (!parsed) return null;
  const part = resolveNotesPart(session.currentPackage(), parsed.noteKind);
  if (!part) return null;
  const notePart = part;
  const note = findNoteById(notePart.root, parsed.noteId);
  if (!note) return null;
  const chunks: string[] = [];
  let remaining = MAX_NOTE_PREVIEW_CHARS;
  const walk = (node: OoxmlNode, depth: number): void => {
    if (depth > 32 || remaining <= 0) return;
    if (node.kind === 'paragraph' && typeof node.id === 'string') {
      const text = (paragraphTextOf(notePart, node.id) ?? '').replace(/\uFFFC/g, '').trim();
      if (text) {
        const chunk = text.slice(0, remaining);
        chunks.push(chunk);
        remaining -= chunk.length;
      }
      return;
    }
    if (node.kind === 'textValue') return;
    for (const child of node.children) walk(child, depth + 1);
  };
  walk(note, 0);
  const joined = chunks.filter(Boolean).join(' ').trim();
  return joined.length > 0 ? joined : null;
}

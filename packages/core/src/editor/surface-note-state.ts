// Read-only note-property state for adapter chrome — no tree mutation.

import type { TreeDocxSessionView } from '@docx-editor.dev/core/binding';
import {
  bodySectionNode,
  enumerateDocumentSections,
  paragraphSectionNode,
} from '../layout/section-properties.ts';
import { sectionIndexForCaret } from './section-scope.ts';
import { storyScopeOfNodeId } from './surface-scope.ts';
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
import { resolveNotesPart } from '../store/package/note-references.ts';
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
  const sectionIndex = sectionIndexForCaret(
    session,
    paragraphId,
    surface.activeScope().kind === 'headerFooter'
      ? { kind: 'headerFooter', rId: surface.headerFooterState()?.rId ?? '' }
      : storyScopeOfNodeId(session, paragraphId, { kind: 'body' }),
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

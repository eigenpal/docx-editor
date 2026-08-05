// Read-only note-property state for adapter chrome — no tree mutation.

import type { TreeDocxSession } from '@docx-editor.dev/core/binding';
import { enumerateDocumentSections, paragraphSectionNode } from '../layout/section-properties.ts';
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
import type { OoxmlNode } from '../store/package/ooxml-tree.ts';
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

function paragraphSectionIndexOf(session: TreeDocxSession, paragraphId: string): number {
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
  return map.get(paragraphId) ?? 0;
}

function sectionSectPrNodes(
  session: TreeDocxSession,
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
  while (nodes.length < sections.length) nodes.push(undefined);
  return nodes;
}

export function notePropertiesStateOf(
  surface: PaginatedSurface | null
): NotePropertiesStateSnapshot | null {
  if (!surface) return null;
  const session = surface.session;
  const paragraphId = surface.state().selection.head.paragraphId;
  const sectionIndex = paragraphSectionIndexOf(session, paragraphId);
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

export function listNormalNoteIds(session: TreeDocxSession, noteKind: NoteKind): readonly number[] {
  const part = resolveNotesPart(session.currentPackage(), noteKind);
  if (!part) return [];
  return notesOf(part.root)
    .filter((note) => isNormalNote(note))
    .map((note) => noteIdOf(note))
    .filter((id): id is number => id !== null);
}

/** Plain text preview for a note scope id — safe for tooltip display. */
export function notePreviewTextOf(session: TreeDocxSession, scopeId: string): string | null {
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

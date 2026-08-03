// Note reference resolution and load diagnostics.
//
// Fail-open on load (matching `resolveHeaderFooterParts`): dangling references are
// retained and reported. Mutation paths that target a missing note fail closed elsewhere.

import { WML_NAMESPACE_URI } from './ooxml-shared.ts';
import type { OoxmlNode, OoxmlPart } from './ooxml-tree.ts';
import type { OoxmlPackage } from './ooxml-package.ts';
import { resolveRelationship } from './relationships.ts';
import {
  findNoteById,
  isNormalNote,
  noteIdOf,
  noteKindOf,
  noteReferenceKindOf,
  type NoteKind,
  MAX_NOTES_PER_PART,
} from './note-nodes.ts';

const FOOTNOTES_REL =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes';
const ENDNOTES_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/endnotes';

/** Cap on reference sites scanned across stories. */
export const MAX_NOTE_REFERENCE_SCAN = 20_000;

export type NoteDiagnosticCode = 'dangling-note-reference';

export interface NoteDiagnostic {
  readonly code: NoteDiagnosticCode;
  readonly noteKind: NoteKind;
  readonly noteId: number;
  /** Paragraph / container node id when known. */
  readonly sourceNodeId?: string;
}

export interface NoteReferenceHit {
  readonly noteKind: NoteKind;
  readonly noteId: number;
  readonly nodeId: string;
  readonly paragraphId: string;
  readonly customMarkFollows: boolean;
}

function isWml(node: OoxmlNode, localName: string): boolean {
  return (
    node.kind !== 'textValue' &&
    node.namespaceUri === WML_NAMESPACE_URI &&
    node.localName === localName
  );
}

function attribute(node: OoxmlNode, localName: string): string | undefined {
  if (node.kind === 'textValue' || !('attributes' in node)) return undefined;
  for (const entry of node.attributes) {
    if (entry.localName !== localName) continue;
    if (entry.namespaceUri === WML_NAMESPACE_URI || entry.namespaceUri === '') return entry.value;
  }
  return undefined;
}

function customMarkFollowsOf(node: OoxmlNode): boolean {
  const raw = attribute(node, 'customMarkFollows');
  if (raw === undefined) {
    if (node.kind === 'textValue' || !('attributes' in node)) return false;
    return node.attributes.some(
      (entry) =>
        entry.localName === 'customMarkFollows' &&
        (entry.namespaceUri === WML_NAMESPACE_URI || entry.namespaceUri === '')
    );
  }
  return !(raw === '0' || raw === 'false' || raw === 'off');
}

/** Resolve the footnotes or endnotes part via safe Internal document relationships. */
export function resolveNotesPart(pkg: OoxmlPackage, noteKind: NoteKind): OoxmlPart | null {
  const typeUri = noteKind === 'footnote' ? FOOTNOTES_REL : ENDNOTES_REL;
  const expectedRoot = noteKind === 'footnote' ? 'footnotes' : 'endnotes';
  const relationships = pkg.relationships.get(pkg.mainDocumentPart) ?? [];
  for (const record of relationships) {
    if (record.type !== typeUri) continue;
    const resolved = resolveRelationship(record);
    if (resolved.mode !== 'Internal' || !resolved.target.ok) return null;
    const part = pkg.parts.get(resolved.target.partName);
    if (!part) return null;
    if (part.root.localName !== expectedRoot) return null;
    return part;
  }
  return null;
}

/**
 * Walk a part for typed/generic note references. Bounded; skips deep hostile nesting.
 */
export function collectNoteReferences(
  part: OoxmlPart,
  options?: { readonly max?: number }
): readonly NoteReferenceHit[] {
  const max = options?.max ?? MAX_NOTE_REFERENCE_SCAN;
  const hits: NoteReferenceHit[] = [];
  let scanned = 0;

  const walk = (node: OoxmlNode, paragraphId: string | null, depth: number): void => {
    if (hits.length >= max || scanned >= max || depth > 64) return;
    scanned += 1;
    if (node.kind === 'textValue') return;

    const nextParagraph = node.kind === 'paragraph' ? node.id : paragraphId;

    const refKind = noteReferenceKindOf(node);
    if (refKind) {
      const noteId = noteIdOf(node);
      if (noteId !== null && nextParagraph) {
        hits.push({
          noteKind: refKind,
          noteId,
          nodeId: node.id,
          paragraphId: nextParagraph,
          customMarkFollows: customMarkFollowsOf(node),
        });
      }
      return;
    }

    for (const child of node.children) walk(child, nextParagraph, depth + 1);
  };

  walk(part.root, null, 0);
  return hits;
}

/** Collect references across body + every XML part (bounded). */
export function collectPackageNoteReferences(pkg: OoxmlPackage): readonly NoteReferenceHit[] {
  const hits: NoteReferenceHit[] = [];
  let remaining = MAX_NOTE_REFERENCE_SCAN;
  for (const part of pkg.parts.values()) {
    if (remaining <= 0) break;
    if (!part.name.endsWith('.xml')) continue;
    const batch = collectNoteReferences(part, { max: remaining });
    hits.push(...batch);
    remaining -= batch.length;
  }
  return hits;
}

/**
 * Load diagnostics for dangling note references. Fail-open: never throws; returns
 * diagnostics for callers to surface. Does not invent missing note bodies.
 */
export function diagnoseNoteReferences(pkg: OoxmlPackage): readonly NoteDiagnostic[] {
  const footnotes = resolveNotesPart(pkg, 'footnote');
  const endnotes = resolveNotesPart(pkg, 'endnote');
  const diagnostics: NoteDiagnostic[] = [];

  const noteExists = (kind: NoteKind, id: number): boolean => {
    const part = kind === 'footnote' ? footnotes : endnotes;
    if (!part) return false;
    const note = findNoteById(part.root, id);
    return note !== undefined && (isNormalNote(note) || noteKindOf(note) !== null);
  };

  for (const hit of collectPackageNoteReferences(pkg)) {
    if (noteExists(hit.noteKind, hit.noteId)) continue;
    diagnostics.push({
      code: 'dangling-note-reference',
      noteKind: hit.noteKind,
      noteId: hit.noteId,
      sourceNodeId: hit.nodeId,
    });
    if (diagnostics.length >= MAX_NOTES_PER_PART) break;
  }
  return diagnostics;
}

/** Whether a notes-part root contains a note with the given id (any type). */
export function notesPartHasId(part: OoxmlPart, noteId: number): boolean {
  return findNoteById(part.root, noteId) !== undefined;
}

/** List normal (body) note ids in document order, bounded. */
export function normalNoteIds(part: OoxmlPart): readonly number[] {
  const ids: number[] = [];
  if (part.root.kind !== 'footnotes' && part.root.kind !== 'endnotes') return ids;
  for (const child of part.root.children) {
    if (ids.length >= MAX_NOTES_PER_PART) break;
    if (!isWml(child, 'footnote') && !isWml(child, 'endnote') && child.kind !== 'note') continue;
    if (!isNormalNote(child)) continue;
    const id = noteIdOf(child);
    if (id !== null && id > 0) ids.push(id);
  }
  return ids;
}

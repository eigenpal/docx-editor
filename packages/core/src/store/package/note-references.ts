// Note reference resolution and load diagnostics.
//
// Fail-open on load (matching `resolveHeaderFooterParts`): dangling references are
// retained and reported. Mutation paths that target a missing note fail closed elsewhere.
//
// Scans are bounded by visited nodes (not hit count). Package-wide collectors share one
// visited budget so hostile parts cannot multiply a per-part cap.

import { WML_NAMESPACE_URI } from './ooxml-shared.ts';
import type { OoxmlNode, OoxmlParagraphNode, OoxmlPart } from './ooxml-tree.ts';
import type { OoxmlPackage } from './ooxml-package.ts';
import { resolveRelationship } from './relationships.ts';
import {
  atomicFieldSpansOf,
  isFieldChrome,
  isFldChar,
  isFldSimple,
  isInstrText,
} from './field-nodes.ts';
import {
  atomicNoteSpansOf,
  findNoteById,
  isNormalNote,
  isNoteAtomNode,
  noteIdOf,
  noteKindOf,
  noteReferenceKindOf,
  type NoteKind,
  MAX_NOTES_PER_PART,
} from './note-nodes.ts';

const FOOTNOTES_REL =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes';
const ENDNOTES_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/endnotes';

/** Cap on nodes visited while scanning for note references across stories. */
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
  /** Canonical UTF-16 atom offset within {@link paragraphId} (U+FFFC model). */
  readonly atomOffset: number;
  readonly customMarkFollows: boolean;
}

/** Mutable visited-node budget shared across parts / package snapshots. */
export interface NoteReferenceScanBudget {
  visited: number;
  readonly maxVisited: number;
  /** Set when a walk stops before finishing because the visited cap was hit. */
  truncated: boolean;
}

export function createNoteReferenceScanBudget(
  maxVisited: number = MAX_NOTE_REFERENCE_SCAN
): NoteReferenceScanBudget {
  return { visited: 0, maxVisited, truncated: false };
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

function charge(budget: NoteReferenceScanBudget | undefined): boolean {
  if (!budget) return true;
  if (budget.visited >= budget.maxVisited) {
    budget.truncated = true;
    return false;
  }
  budget.visited += 1;
  return true;
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
 * Collect note references inside one paragraph with canonical UTF-16 atom offsets.
 * Offset rules mirror `segmentsOf` (fields + note atoms = one unit each).
 */
function collectParagraphNoteReferences(
  paragraph: OoxmlParagraphNode,
  hits: NoteReferenceHit[],
  budget: NoteReferenceScanBudget | undefined,
  maxHits: number
): void {
  if (hits.length >= maxHits || (budget && budget.truncated)) return;

  let offset = 0;
  const fieldAtoms = atomicFieldSpansOf(paragraph);
  const noteAtoms = atomicNoteSpansOf(paragraph);
  const atomByBeginId = new Map(fieldAtoms.map((span) => [span.node.id, span]));
  const noteAtomById = new Map(noteAtoms.map((span) => [span.node.id, span]));
  const covered = new Set<string>();
  for (const span of fieldAtoms) {
    for (const id of span.removeNodeIds) covered.add(id);
  }

  const visitRunChild = (node: OoxmlNode): void => {
    if (hits.length >= maxHits || (budget && budget.truncated)) return;
    if (!charge(budget)) return;

    const fieldAtom = atomByBeginId.get(node.id);
    if (fieldAtom && fieldAtom.kind === 'complex') {
      offset += 1;
      return;
    }
    if (covered.has(node.id)) return;

    const noteAtom = noteAtomById.get(node.id);
    if (noteAtom || isNoteAtomNode(node)) {
      const refKind = noteReferenceKindOf(node);
      if (refKind) {
        const noteId = noteIdOf(node);
        if (noteId !== null && hits.length < maxHits) {
          hits.push({
            noteKind: refKind,
            noteId,
            nodeId: node.id,
            paragraphId: paragraph.id,
            atomOffset: offset,
            customMarkFollows: customMarkFollowsOf(node),
          });
        }
      }
      offset += 1;
      return;
    }

    if (
      isFieldChrome(node) ||
      isFldChar(node, 'begin') ||
      isFldChar(node, 'separate') ||
      isFldChar(node, 'end') ||
      isInstrText(node)
    ) {
      return;
    }
    if (node.kind === 'textValue') {
      offset += node.value.length;
      return;
    }
    if (node.kind === 'tab' || node.kind === 'hardBreak') {
      offset += 1;
      return;
    }
    if (node.kind === 'runProperties' || node.kind === 'generic') return;
    if (node.kind === 'text') {
      for (const child of node.children) visitRunChild(child);
      return;
    }
    for (const child of node.children) visitRunChild(child);
  };

  const visitInline = (child: OoxmlNode): void => {
    if (hits.length >= maxHits || (budget && budget.truncated)) return;
    if (!charge(budget)) return;

    if (isFldSimple(child)) {
      const atom = atomByBeginId.get(child.id);
      if (atom) offset += 1;
      return;
    }
    if (child.kind === 'run') {
      for (const grand of child.children) visitRunChild(grand);
      return;
    }
    if (child.kind === 'hyperlink') {
      for (const inner of child.children) visitInline(inner);
    }
  };

  for (const child of paragraph.children) visitInline(child);
}

/**
 * Walk a part for typed/generic note references. Bounded by visited nodes; skips deep
 * hostile nesting. When `budget` is supplied it is shared and mutated in place.
 */
export function collectNoteReferences(
  part: OoxmlPart,
  options?: {
    readonly maxHits?: number;
    readonly budget?: NoteReferenceScanBudget;
  }
): readonly NoteReferenceHit[] {
  const maxHits = options?.maxHits ?? MAX_NOTE_REFERENCE_SCAN;
  const budget = options?.budget;
  const hits: NoteReferenceHit[] = [];

  const walk = (node: OoxmlNode, depth: number): void => {
    if (hits.length >= maxHits || depth > 64) return;
    if (!charge(budget)) return;
    if (node.kind === 'textValue') return;

    if (node.kind === 'paragraph') {
      collectParagraphNoteReferences(node, hits, budget, maxHits);
      return;
    }

    for (const child of node.children) walk(child, depth + 1);
  };

  walk(part.root, 0);
  return hits;
}

/** Collect references across every XML part under one shared visited-node budget. */
export function collectPackageNoteReferences(
  pkg: OoxmlPackage,
  options?: { readonly budget?: NoteReferenceScanBudget }
): readonly NoteReferenceHit[] {
  const budget = options?.budget ?? createNoteReferenceScanBudget();
  const hits: NoteReferenceHit[] = [];
  for (const part of pkg.parts.values()) {
    if (budget.truncated || hits.length >= MAX_NOTE_REFERENCE_SCAN) break;
    if (!part.name.endsWith('.xml')) continue;
    const batch = collectNoteReferences(part, {
      maxHits: MAX_NOTE_REFERENCE_SCAN - hits.length,
      budget,
    });
    hits.push(...batch);
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

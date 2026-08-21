// Note reference resolution and load diagnostics.
//
// Fail-open on load (matching `resolveHeaderFooterParts`): dangling references are
// retained and reported. Mutation paths that target a missing note fail closed elsewhere.
//
// Scans are bounded by visited nodes (not hit count) and XML part count. Package-wide
// collectors share one budget so hostile parts cannot multiply a per-part cap. Mutation
// callers MUST treat `budget.truncated` as atomic failure — never apply a partial rewrite.

import { WML_NAMESPACE_URI } from './ooxml-shared.ts';
import type { OoxmlNode, OoxmlParagraphNode, OoxmlPart } from './ooxml-tree.ts';
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
import { segmentsOf } from '../store/tree-op-segments.ts';

const FOOTNOTES_REL =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes';
const ENDNOTES_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/endnotes';

/** Cap on nodes visited while scanning for note references across stories. */
export const MAX_NOTE_REFERENCE_SCAN = 20_000;

/**
 * Higher bounded cap for explicit note mutations. Diagnostics stay cheap at
 * `MAX_NOTE_REFERENCE_SCAN`; lifecycle commands must still work on ordinary long documents.
 */
export const MAX_NOTE_REFERENCE_MUTATION_SCAN = 1_000_000;

/**
 * Cap on XML parts walked in one package-wide note-reference scan (N/N+1 gate).
 * Soft targets are not allowed: exceeding this marks the shared budget truncated.
 */
export const MAX_NOTE_REFERENCE_PARTS = 256;

/**
 * A load-time note problem worth reporting.
 *
 * `dangling-note-reference` is a citation pointing at no note; `note-reference-scan-truncated`
 * says the scan hit its budget, so absence of further diagnostics is not proof of correctness.
 */
export type NoteDiagnosticCode = 'dangling-note-reference' | 'note-reference-scan-truncated';

/**
 * Load-time note diagnostics. Array API preserved; truncation is signaled as a typed
 * entry rather than by throwing or rejecting the package.
 */
export type NoteDiagnostic =
  | {
      readonly code: 'dangling-note-reference';
      readonly noteKind: NoteKind;
      readonly noteId: number;
      /** Paragraph / container node id when known. */
      readonly sourceNodeId?: string;
    }
  | {
      /** Hard visited/part budget or soft hit cap stopped the scan before full coverage. */
      readonly code: 'note-reference-scan-truncated';
    };

/** One note reference found in a story, with where it sits. */
export interface NoteReferenceHit {
  readonly noteKind: NoteKind;
  readonly noteId: number;
  readonly nodeId: string;
  readonly paragraphId: string;
  /** Canonical UTF-16 atom offset within {@link paragraphId} (U+FFFC model). */
  readonly atomOffset: number;
  readonly customMarkFollows: boolean;
  /** Canonical part name that owns this reference. */
  readonly partName: string;
}

/** Mutable visited-node + part budget shared across parts / package snapshots. */
export interface NoteReferenceScanBudget {
  visited: number;
  readonly maxVisited: number;
  parts: number;
  readonly maxParts: number;
  /** Set when a walk stops before finishing because a cap was hit. */
  truncated: boolean;
}

/** A bounded budget for scanning note references, so a crafted document cannot stall a load. */
export function createNoteReferenceScanBudget(
  maxVisited: number = MAX_NOTE_REFERENCE_SCAN,
  maxParts: number = MAX_NOTE_REFERENCE_PARTS
): NoteReferenceScanBudget {
  return { visited: 0, maxVisited, parts: 0, maxParts, truncated: false };
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

function chargePart(budget: NoteReferenceScanBudget): boolean {
  if (budget.parts >= budget.maxParts) {
    budget.truncated = true;
    return false;
  }
  budget.parts += 1;
  return true;
}

/**
 * Resolve the footnotes or endnotes part via safe Internal document relationships.
 *
 * Unusable matching relationships (External, unsafe target, missing part, wrong root)
 * are skipped — never fetched, never accepted — so a decoy first match cannot hide a
 * later usable Internal notes part (same continue-past-bad pattern as settingsPartOf).
 */
export function resolveNotesPart(pkg: OoxmlPackage, noteKind: NoteKind): OoxmlPart | null {
  const typeUri = noteKind === 'footnote' ? FOOTNOTES_REL : ENDNOTES_REL;
  const expectedRoot = noteKind === 'footnote' ? 'footnotes' : 'endnotes';
  const relationships = pkg.relationships.get(pkg.mainDocumentPart) ?? [];
  for (const record of relationships) {
    if (record.type !== typeUri) continue;
    const resolved = resolveRelationship(record);
    if (resolved.mode !== 'Internal' || !resolved.target.ok) continue;
    const part = pkg.parts.get(resolved.target.partName);
    if (!part) continue;
    if (part.root.localName !== expectedRoot) continue;
    return part;
  }
  return null;
}

function pushReferenceHit(
  hits: NoteReferenceHit[],
  node: OoxmlNode,
  paragraphId: string,
  atomOffset: number,
  partName: string,
  maxHits: number
): void {
  const refKind = noteReferenceKindOf(node);
  if (!refKind) return;
  const noteId = noteIdOf(node);
  if (noteId === null || hits.length >= maxHits) return;
  hits.push({
    noteKind: refKind,
    noteId,
    nodeId: node.id,
    paragraphId,
    atomOffset,
    customMarkFollows: customMarkFollowsOf(node),
    partName,
  });
}

/**
 * Collect addressable note references inside one paragraph.
 *
 * `atomOffset` is taken from the canonical UTF-16 segment model (`segmentsOf`): typed
 * `noteReference` segment nodes only. Generic/demoted wrappers (inline SDT husks,
 * malformed refs) contribute no phantom atoms and must not shift later offsets.
 * Lifecycle still removes those hits by node id in typed stories; demoted content stays
 * preserved in-tree for fail-open load without inventing a second address space.
 */
function collectParagraphNoteReferences(
  paragraph: OoxmlParagraphNode,
  hits: NoteReferenceHit[],
  budget: NoteReferenceScanBudget | undefined,
  maxHits: number,
  partName: string
): void {
  if (hits.length >= maxHits || (budget && budget.truncated)) return;

  for (const segment of segmentsOf(paragraph)) {
    if (hits.length >= maxHits || (budget && budget.truncated)) return;
    if (!charge(budget)) return;
    if (segment.node.kind !== 'noteReference') continue;
    pushReferenceHit(hits, segment.node, paragraph.id, segment.start, partName, maxHits);
  }
}

/**
 * Walk a part for addressable typed note references. Bounded by visited nodes; skips deep
 * hostile nesting by marking the shared budget truncated. When `budget` is supplied it is
 * shared and mutated in place. Hits are segment-aligned (`segmentsOf`); demoted wrappers
 * never invent atomOffsets.
 */
/**
 * Per-paragraph note-reference memo, keyed on the immutable paragraph node.
 *
 * Only the budget-free scan uses it (layout runs one per published pass over a part whose
 * paragraphs are all shared but the edited one); budgeted mutation scans keep the plain
 * walk so their visited accounting stays exact.
 */
const paragraphNoteHitMemos = new WeakMap<OoxmlNode, readonly NoteReferenceHit[]>();

function paragraphNoteHitsOf(
  paragraph: OoxmlParagraphNode,
  partName: string
): readonly NoteReferenceHit[] {
  const cached = paragraphNoteHitMemos.get(paragraph);
  if (cached) return cached;
  const hits: NoteReferenceHit[] = [];
  collectParagraphNoteReferences(paragraph, hits, undefined, MAX_NOTE_REFERENCE_SCAN, partName);
  paragraphNoteHitMemos.set(paragraph, hits);
  return hits;
}

export function collectNoteReferences(
  part: OoxmlPart,
  options?: {
    readonly maxHits?: number;
    readonly budget?: NoteReferenceScanBudget;
  }
): readonly NoteReferenceHit[] {
  // Hit count is a soft collector bound for diagnostics only. Mutation paths pass an
  // unbounded maxHits and rely on the visited-node budget (+ truncation) instead.
  const maxHits = options?.maxHits ?? MAX_NOTE_REFERENCE_SCAN;
  const budget = options?.budget;
  const memoized = budget === undefined;
  const hits: NoteReferenceHit[] = [];

  const walk = (node: OoxmlNode, depth: number): void => {
    if (hits.length >= maxHits || (budget && budget.truncated)) return;
    if (depth > 64) {
      if (budget) budget.truncated = true;
      return;
    }
    if (!charge(budget)) return;
    if (node.kind === 'textValue') return;

    if (node.kind === 'paragraph') {
      if (memoized) {
        for (const hit of paragraphNoteHitsOf(node, part.name)) {
          if (hits.length >= maxHits) return;
          hits.push(hit);
        }
        return;
      }
      collectParagraphNoteReferences(node, hits, budget, maxHits, part.name);
      return;
    }

    for (const child of node.children) walk(child, depth + 1);
  };

  walk(part.root, 0);
  return hits;
}

/** Collect references across every XML part under one shared part + visited-node budget. */
export function collectPackageNoteReferences(
  pkg: OoxmlPackage,
  options?: {
    readonly budget?: NoteReferenceScanBudget;
    /** Soft hit cap for diagnostics. Omit / Infinity for mutation scans. */
    readonly maxHits?: number;
  }
): readonly NoteReferenceHit[] {
  const budget = options?.budget ?? createNoteReferenceScanBudget();
  const maxHits = options?.maxHits ?? MAX_NOTE_REFERENCE_SCAN;
  const hits: NoteReferenceHit[] = [];
  for (const part of pkg.parts.values()) {
    if (budget.truncated) break;
    if (!part.name.endsWith('.xml')) continue;
    if (!chargePart(budget)) break;
    const batch = collectNoteReferences(part, {
      maxHits: Number.isFinite(maxHits) ? Math.max(0, maxHits - hits.length) : maxHits,
      budget,
    });
    hits.push(...batch);
  }
  return hits;
}

/**
 * Load diagnostics for dangling note references. Fail-open: never throws or mutates;
 * returns diagnostics for callers to surface. Does not invent missing note bodies.
 *
 * When the hard visited/part budget truncates or the soft hit cap binds, appends a single
 * `note-reference-scan-truncated` entry so incomplete coverage is visible without breaking
 * consumers that filter on `dangling-note-reference`.
 */
export function diagnoseNoteReferences(pkg: OoxmlPackage): readonly NoteDiagnostic[] {
  const footnotes = resolveNotesPart(pkg, 'footnote');
  const endnotes = resolveNotesPart(pkg, 'endnote');
  const diagnostics: NoteDiagnostic[] = [];
  const budget = createNoteReferenceScanBudget();
  const maxHits = MAX_NOTE_REFERENCE_SCAN;
  const hits = collectPackageNoteReferences(pkg, { budget, maxHits });

  const noteExists = (kind: NoteKind, id: number): boolean => {
    const part = kind === 'footnote' ? footnotes : endnotes;
    if (!part) return false;
    const note = findNoteById(part.root, id);
    return note !== undefined && (isNormalNote(note) || noteKindOf(note) !== null);
  };

  for (const hit of hits) {
    if (noteExists(hit.noteKind, hit.noteId)) continue;
    diagnostics.push({
      code: 'dangling-note-reference',
      noteKind: hit.noteKind,
      noteId: hit.noteId,
      sourceNodeId: hit.nodeId,
    });
    if (diagnostics.length >= MAX_NOTES_PER_PART) break;
  }

  // Soft maxHits stops without setting budget.truncated; treat a full hit buffer as
  // incomplete coverage (≥ cap). Exact-cap packages are astronomically rare at 20k.
  if (budget.truncated || hits.length >= maxHits) {
    diagnostics.push({ code: 'note-reference-scan-truncated' });
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

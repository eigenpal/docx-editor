/* eslint-disable max-lines -- note lifecycle seam: insert/delete/convert/bulk + style rewrite */

// Footnote/endnote package lifecycle: insert, delete, convert, set properties.
//
// These mutations touch the main document (or other stories), the notes part,
// document rels, and `[Content_Types].xml` — never a single story tree alone.
// Application is pure: given a package and an op, return a new package or a typed
// rejection, with no partial writes.
//
// Security: engine-authored XML is literals + validated integers only; relationship
// targets are relative safe paths; scans are bounded; no field/macro execution.

import {
  createNodeIdAllocator,
  findNode,
  insertChildren,
  removeNode,
  replaceChildren,
  replaceNode,
} from './ooxml-edit.ts';
import {
  readOoxmlPart,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
  type OoxmlParagraphNode,
} from './ooxml-tree.ts';
import type { OoxmlPackage } from './ooxml-package.ts';
import { withPart } from './ooxml-package.ts';
import { WML_NAMESPACE_URI } from './ooxml-shared.ts';
import {
  allocateNoteId,
  atomicNoteSpansOf,
  findNoteById,
  isNoteAtomNode,
  noteIdOf,
  noteKindOf,
  noteRefKindOf,
  noteReferenceKindOf,
  noteTypeOf,
  type NoteKind,
  NOTE_ID_MAX,
  NOTE_ID_MIN,
} from './note-nodes.ts';
import {
  freeRelationshipId,
  withContentTypeOverride,
  withFreshIds,
  withNotesRelationship,
} from './note-lifecycle-shell.ts';
import { writeDocumentNoteProperties, writeSectionNoteProperties } from './note-lifecycle-props.ts';
import {
  isLegalEndnotePosition,
  isLegalFootnotePosition,
  isLegalNumRestart,
} from './note-properties.ts';
import {
  collectPackageNoteReferences,
  createNoteReferenceScanBudget,
  MAX_NOTE_REFERENCE_MUTATION_SCAN,
  resolveNotesPart,
  normalNoteIds,
  type NoteReferenceHit,
  type NoteReferenceScanBudget,
} from './note-references.ts';
import { isValidXmlText } from './sinks.ts';
import { atomicFieldSpansOf, isFldSimple } from './field-nodes.ts';
import { isContentControl, walkParagraphInline } from './content-control-walk.ts';

const W = WML_NAMESPACE_URI;
const FOOTNOTES_REL =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes';
const ENDNOTES_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/endnotes';
const FOOTNOTES_CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml';
const ENDNOTES_CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml.endnotes+xml';
const MAX_SECTIONS = 4_096;

/** Built-in Word character styles for note marks — not user theme aliases. */
const BUILTIN_NOTE_REFERENCE_STYLE: Readonly<Record<NoteKind, string>> = {
  footnote: 'FootnoteReference',
  endnote: 'EndnoteReference',
};

function isWmlValAttribute(attr: {
  readonly localName: string;
  readonly namespaceUri: string;
}): boolean {
  return (
    attr.localName === 'val' &&
    (attr.namespaceUri === WML_NAMESPACE_URI || attr.namespaceUri === '')
  );
}

/**
 * Rewrite `w:rStyle/@w:val` on a run that directly holds a note citation or body mark.
 *
 * Matching rule (bounded): only when the run contains a `noteReference` / `noteRef` atom
 * (typed or generic `w:footnoteReference`, `w:endnoteReference`, `w:footnoteRef`,
 * `w:endnoteRef`) AND a WML-namespaced `w:rPr/w:rStyle` whose WML `@w:val` exactly equals
 * the source kind's built-in style (`FootnoteReference` / `EndnoteReference`). Foreign
 * namespace `rStyle` / `val` attributes are preserved byte-for-byte. Custom style ids,
 * absent `rPr`, and absent `rStyle` are left unchanged — Word does not require a character
 * style on note marks for validity; layout resolves marks through element type + cascade
 * defaults.
 */
function rewriteRunBuiltinNoteReferenceStyle(
  run: OoxmlNode,
  fromKind: NoteKind,
  toKind: NoteKind
): OoxmlNode {
  if (run.kind !== 'run' || fromKind === toKind) return run;
  if (!run.children.some((child) => isNoteRefAtomInRun(child))) return run;

  const fromStyle = BUILTIN_NOTE_REFERENCE_STYLE[fromKind];
  const toStyle = BUILTIN_NOTE_REFERENCE_STYLE[toKind];

  let changed = false;
  const children = run.children.map((child) => {
    if (child.kind !== 'runProperties') return child;
    let propsChanged = false;
    const props = child.children.map((prop) => {
      if (
        prop.kind !== 'generic' ||
        prop.namespaceUri !== WML_NAMESPACE_URI ||
        prop.localName !== 'rStyle'
      ) {
        return prop;
      }
      const hasFromVal = prop.attributes.some(
        (attr) => isWmlValAttribute(attr) && attr.value === fromStyle
      );
      if (!hasFromVal) return prop;
      propsChanged = true;
      changed = true;
      return {
        ...prop,
        attributes: prop.attributes.map((attr) =>
          isWmlValAttribute(attr) && attr.value === fromStyle ? { ...attr, value: toStyle } : attr
        ),
      };
    });
    return propsChanged ? { ...child, children: props } : child;
  });
  return changed ? ({ ...run, children } as OoxmlNode) : run;
}

function isNoteRefAtomInRun(node: OoxmlNode): boolean {
  return noteReferenceKindOf(node) !== null || noteRefKindOf(node) !== null;
}

export type NoteLifecycleImpact = 'flow-structural' | 'global';

export type NoteLifecycleOp =
  | {
      readonly op: 'insertNote';
      readonly noteKind: NoteKind;
      readonly paragraphId: string;
      readonly offset: number;
    }
  | {
      readonly op: 'deleteNote';
      readonly noteKind: NoteKind;
      readonly noteId: number;
    }
  | {
      readonly op: 'convertNote';
      readonly fromKind: NoteKind;
      readonly noteId: number;
    }
  | {
      /**
       * Convert every normal note of `fromKind` in document order. One atomic package
       * transaction / undo unit with the same validation as repeated `convertNote`.
       */
      readonly op: 'convertAllNotes';
      readonly fromKind: NoteKind;
    }
  | {
      readonly op: 'setNoteProperties';
      readonly scope: 'document' | 'section';
      readonly sectionIndex?: number;
      readonly footnote?: {
        readonly numFmt?: string;
        readonly numRestart?: string;
        readonly position?: string;
        readonly numStart?: number;
      };
      readonly endnote?: {
        readonly numFmt?: string;
        readonly numRestart?: string;
        readonly position?: string;
        readonly numStart?: number;
      };
    };

export type NoteLifecycleRejection = 'invalidArgs' | 'tree-invariant';

export type NoteLifecycleResult =
  | {
      readonly ok: true;
      readonly package: OoxmlPackage;
      readonly impact: NoteLifecycleImpact;
      readonly noteId?: number;
      readonly noteKind?: NoteKind;
      readonly createdPartName?: string;
    }
  | {
      readonly ok: false;
      readonly reason: NoteLifecycleRejection;
      readonly detail?: string;
    };

const LIFECYCLE_OPS = new Set([
  'insertNote',
  'deleteNote',
  'convertNote',
  'convertAllNotes',
  'setNoteProperties',
]);

export function isNoteLifecycleOp(op: { readonly op: string }): op is NoteLifecycleOp {
  return LIFECYCLE_OPS.has(op.op);
}

function fail(reason: NoteLifecycleRejection, detail?: string): NoteLifecycleResult {
  return detail ? { ok: false, reason, detail } : { ok: false, reason };
}

function isNoteKind(value: unknown): value is NoteKind {
  return value === 'footnote' || value === 'endnote';
}

function isPositiveNoteId(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= NOTE_ID_MIN &&
    value <= NOTE_ID_MAX
  );
}

export interface NoteLifecycleOptions {
  /**
   * Shared part + visited-node budget for reference scans. When omitted a fresh default
   * budget is used. Truncation rejects the op with the original package unchanged.
   */
  readonly scanBudget?: NoteReferenceScanBudget;
}

function createMutationScanBudget(): NoteReferenceScanBudget {
  return createNoteReferenceScanBudget(MAX_NOTE_REFERENCE_MUTATION_SCAN);
}

/**
 * Apply one note lifecycle op atomically. Rejected ops leave the input package untouched.
 */
export function applyNoteLifecycleOp(
  pkg: OoxmlPackage,
  op: NoteLifecycleOp,
  options?: NoteLifecycleOptions
): NoteLifecycleResult {
  if (!isNoteLifecycleOp(op)) return fail('invalidArgs', 'unknown-op');
  switch (op.op) {
    case 'insertNote':
      return applyInsertNote(pkg, op);
    case 'deleteNote':
      return applyDeleteNote(pkg, op, options);
    case 'convertNote':
      return applyConvertNote(pkg, op, options);
    case 'convertAllNotes':
      return applyConvertAllNotes(pkg, op, options);
    case 'setNoteProperties':
      return applySetNoteProperties(pkg, op);
  }
}

// ---------------------------------------------------------------------------
// insert
// ---------------------------------------------------------------------------

function applyInsertNote(
  pkg: OoxmlPackage,
  op: Extract<NoteLifecycleOp, { op: 'insertNote' }>
): NoteLifecycleResult {
  if (!isNoteKind(op.noteKind)) return fail('invalidArgs', 'noteKind');
  if (typeof op.paragraphId !== 'string' || op.paragraphId.length === 0) {
    return fail('invalidArgs', 'paragraphId');
  }
  if (!Number.isInteger(op.offset) || op.offset < 0) return fail('invalidArgs', 'offset');

  const located = locateInsertParagraph(pkg, op.paragraphId);
  if (!located.ok) return fail('invalidArgs', located.detail);
  const paragraph = located.paragraph;
  const length = paragraphLength(paragraph);
  if (op.offset > length) return fail('invalidArgs', 'offset-out-of-range');

  let next = pkg;
  const ensured = ensureNotesPart(next, op.noteKind);
  if (!ensured.ok) return ensured;
  next = ensured.package;
  const createdPartName = ensured.createdPartName;

  const notesPart = resolveNotesPart(next, op.noteKind);
  if (!notesPart) return fail('tree-invariant', 'missing-notes-part');

  const noteId = allocateNoteId(notesPart.root);
  if (noteId === null) return fail('invalidArgs', 'note-id-exhausted');

  const bodyXml = emptyNoteXml(op.noteKind, noteId);
  const bodyRead = readOoxmlPart(bodyXml, {
    name: notesPart.name,
    contentType: notesPart.contentType,
  });
  if (!bodyRead.ok) return fail('tree-invariant', 'note-body-parse');
  const noteNode = bodyRead.part.root.children.find((child) => child.kind === 'note');
  if (!noteNode) return fail('tree-invariant', 'note-body-missing');

  const notesNextId = createNodeIdAllocator(notesPart);
  const freshNote = withFreshIds(noteNode, notesNextId);
  const appended = insertChildren(notesPart, notesPart.root.id, notesPart.root.children.length, [
    freshNote,
  ]);
  if (!appended.ok) return fail('tree-invariant', 'note-body-insert');
  next = withPart(next, appended.part);

  // Re-locate body paragraph after package updates (main part may be unchanged).
  const storyPart = next.parts.get(located.partName);
  if (!storyPart) return fail('tree-invariant', 'story-missing');
  const storyParagraph = findNode(storyPart, op.paragraphId);
  if (!storyParagraph || storyParagraph.kind !== 'paragraph') {
    return fail('tree-invariant', 'paragraph-missing');
  }
  if (!isParagraphUnderBody(storyPart, op.paragraphId)) {
    return fail('tree-invariant', 'paragraph-not-in-body');
  }

  const refLocal = op.noteKind === 'footnote' ? 'footnoteReference' : 'endnoteReference';
  const styleVal = op.noteKind === 'footnote' ? 'FootnoteReference' : 'EndnoteReference';
  const storyNextId = createNodeIdAllocator(storyPart);
  const refRun = noteReferenceRun(storyNextId, refLocal, noteId, styleVal);
  const inserted = insertNodesAtOffset(storyPart, storyParagraph as OoxmlParagraphNode, op.offset, [
    refRun,
  ]);
  if (!inserted) return fail('tree-invariant', 'reference-insert');
  next = withPart(next, inserted);

  return {
    ok: true,
    package: next,
    impact: 'global',
    noteId,
    noteKind: op.noteKind,
    ...(createdPartName ? { createdPartName } : {}),
  };
}

// ---------------------------------------------------------------------------
// delete
// ---------------------------------------------------------------------------

function applyDeleteNote(
  pkg: OoxmlPackage,
  op: Extract<NoteLifecycleOp, { op: 'deleteNote' }>,
  options?: NoteLifecycleOptions
): NoteLifecycleResult {
  if (!isNoteKind(op.noteKind)) return fail('invalidArgs', 'noteKind');
  // Reserved non-positive ids own separators/continuation notices, not user notes.
  if (!isPositiveNoteId(op.noteId)) return fail('invalidArgs', 'noteId');

  const notesPart = resolveNotesPart(pkg, op.noteKind);
  if (!notesPart) return fail('invalidArgs', 'missing-notes-part');
  const note = findNoteById(notesPart.root, op.noteId);
  if (!note) return fail('invalidArgs', 'note-not-found');

  const removedRefs = removeReferencesEverywhere(pkg, op.noteKind, op.noteId, options?.scanBudget);
  if (!removedRefs) return fail('tree-invariant', 'reference-scan-truncated');
  let next = removedRefs;

  const currentNotes = resolveNotesPart(next, op.noteKind);
  if (!currentNotes) return fail('tree-invariant', 'notes-part-lost');
  const currentNote = findNoteById(currentNotes.root, op.noteId);
  if (!currentNote) {
    // Body already gone (e.g. only refs); still success if refs removed.
    return { ok: true, package: next, impact: 'global', noteId: op.noteId, noteKind: op.noteKind };
  }
  const removed = removeNode(currentNotes, currentNote.id);
  if (!removed.ok) return fail('tree-invariant', 'note-body-remove');
  next = withPart(next, removed.part);

  return {
    ok: true,
    package: next,
    impact: 'global',
    noteId: op.noteId,
    noteKind: op.noteKind,
  };
}

export interface CascadeDeletedNoteReferencesOptions {
  /**
   * Independent full budgets per snapshot. When omitted each snapshot gets its own
   * default budget — never share one counter across before/after walks.
   */
  readonly beforeBudget?: NoteReferenceScanBudget;
  readonly afterBudget?: NoteReferenceScanBudget;
}

/**
 * Remove note bodies for references that disappeared between two package snapshots.
 * Used when `deleteText` or `deleteBlock` removes a `noteReference` atom so body+ref stay
 * one undo unit.
 *
 * Each snapshot gets an independent full visited/part budget. If either scan truncates
 * the cascade fails closed so a hostile package cannot skip body deletion silently —
 * without accidentally halving capacity by charging both walks to one counter.
 */
export function cascadeDeletedNoteReferences(
  before: OoxmlPackage,
  after: OoxmlPackage,
  options?: CascadeDeletedNoteReferencesOptions
): OoxmlPackage | null {
  const beforeBudget = options?.beforeBudget ?? createMutationScanBudget();
  const afterBudget = options?.afterBudget ?? createMutationScanBudget();
  const beforeHits = collectPackageNoteReferences(before, {
    budget: beforeBudget,
    maxHits: Number.POSITIVE_INFINITY,
  });
  const afterHits = collectPackageNoteReferences(after, {
    budget: afterBudget,
    maxHits: Number.POSITIVE_INFINITY,
  });
  if (beforeBudget.truncated || afterBudget.truncated) return null;
  const afterKeys = new Set(afterHits.map((hit) => `${hit.noteKind}:${hit.noteId}`));
  let next: OoxmlPackage = after;
  const seen = new Set<string>();
  for (const hit of beforeHits) {
    const key = `${hit.noteKind}:${hit.noteId}`;
    if (afterKeys.has(key) || seen.has(key)) continue;
    seen.add(key);
    // Only cascade normal positive ids — never delete separator notes via text delete.
    if (hit.noteId <= 0) continue;
    // A reference whose BODY the package never held has stranded nothing, so there is
    // nothing to cascade. `applyDeleteNote` refuses on a missing part or a missing body, and
    // treating that refusal as a failed cascade rolled the user's edit back: deleting a
    // reference to a note the file does not define made the delete itself impossible.
    const notesPart = resolveNotesPart(next, hit.noteKind);
    if (!notesPart || !findNoteById(notesPart.root, hit.noteId)) continue;
    const result = applyDeleteNote(next, {
      op: 'deleteNote',
      noteKind: hit.noteKind,
      noteId: hit.noteId,
    });
    if (!result.ok) return null;
    next = result.package;
  }
  return next;
}

// ---------------------------------------------------------------------------
// convert
// ---------------------------------------------------------------------------

function applyConvertNote(
  pkg: OoxmlPackage,
  op: Extract<NoteLifecycleOp, { op: 'convertNote' }>,
  options?: NoteLifecycleOptions,
  prescanned?: readonly NoteReferenceHit[]
): NoteLifecycleResult {
  if (!isNoteKind(op.fromKind)) return fail('invalidArgs', 'fromKind');
  if (!isPositiveNoteId(op.noteId)) return fail('invalidArgs', 'noteId');

  const toKind: NoteKind = op.fromKind === 'footnote' ? 'endnote' : 'footnote';
  const sourcePart = resolveNotesPart(pkg, op.fromKind);
  if (!sourcePart) return fail('invalidArgs', 'missing-source-part');
  const sourceNote = findNoteById(sourcePart.root, op.noteId);
  if (!sourceNote) return fail('invalidArgs', 'note-not-found');
  const type = noteTypeOf(sourceNote);
  if (type === 'separator' || type === 'continuationSeparator' || type === 'continuationNotice') {
    return fail('invalidArgs', 'separator-not-convertible');
  }

  // Scan-before-mutate: refuse before any package write if refs cannot be fully walked.
  const plannedHits = plannedReferenceHits(pkg, op.fromKind, op.noteId, options, prescanned);
  if (!plannedHits) return fail('tree-invariant', 'reference-scan-truncated');

  let next = pkg;
  const ensured = ensureNotesPart(next, toKind);
  if (!ensured.ok) return ensured;
  next = ensured.package;
  const createdPartName = ensured.createdPartName;

  const targetPart = resolveNotesPart(next, toKind);
  if (!targetPart) return fail('tree-invariant', 'missing-target-part');
  const newId = allocateNoteId(targetPart.root);
  if (newId === null) return fail('invalidArgs', 'note-id-exhausted');

  // Fresh copy into target part with rewritten localName + id.
  const targetNextId = createNodeIdAllocator(targetPart);
  const moved = rewriteNoteNode(sourceNote, op.fromKind, toKind, newId, targetNextId);
  const appended = insertChildren(targetPart, targetPart.root.id, targetPart.root.children.length, [
    moved,
  ]);
  if (!appended.ok) return fail('tree-invariant', 'target-insert');
  next = withPart(next, appended.part);

  // Remove from source.
  const sourceNow = resolveNotesPart(next, op.fromKind);
  if (!sourceNow) return fail('tree-invariant', 'source-lost');
  const stillThere = findNoteById(sourceNow.root, op.noteId);
  if (stillThere) {
    const removed = removeNode(sourceNow, stillThere.id);
    if (!removed.ok) return fail('tree-invariant', 'source-remove');
    next = withPart(next, removed.part);
  }

  // Rewrite every previously planned reference of the old kind/id to the new kind/id.
  const rewritten = rewriteReferencesEverywhere(next, op.fromKind, toKind, newId, plannedHits);
  if (!rewritten) return fail('tree-invariant', 'reference-rewrite');
  next = rewritten;

  return {
    ok: true,
    package: next,
    impact: 'global',
    noteId: newId,
    noteKind: toKind,
    ...(createdPartName ? { createdPartName } : {}),
  };
}

function plannedReferenceHits(
  pkg: OoxmlPackage,
  fromKind: NoteKind,
  noteId: number,
  options?: NoteLifecycleOptions,
  prescanned?: readonly NoteReferenceHit[]
): readonly NoteReferenceHit[] | null {
  const matches = (hit: NoteReferenceHit): boolean =>
    hit.noteKind === fromKind && hit.noteId === noteId;
  if (prescanned) {
    const reused = prescanned.filter(matches);
    if (reused.every((hit) => referenceStillResolves(pkg, hit))) return reused;
  }
  const budget = options?.scanBudget ?? createMutationScanBudget();
  const hits = collectPackageNoteReferences(pkg, {
    budget,
    maxHits: Number.POSITIVE_INFINITY,
  }).filter(matches);
  return budget.truncated ? null : hits;
}

function referenceStillResolves(pkg: OoxmlPackage, hit: NoteReferenceHit): boolean {
  const part = pkg.parts.get(hit.partName);
  return part !== undefined && findNode(part, hit.nodeId) !== null;
}

function applyConvertAllNotes(
  pkg: OoxmlPackage,
  op: Extract<NoteLifecycleOp, { op: 'convertAllNotes' }>,
  options?: NoteLifecycleOptions
): NoteLifecycleResult {
  if (!isNoteKind(op.fromKind)) return fail('invalidArgs', 'fromKind');
  const sourcePart = resolveNotesPart(pkg, op.fromKind);
  if (!sourcePart) {
    // Nothing to convert — idempotent success (matches empty convert-all UI).
    return { ok: true, package: pkg, impact: 'global' };
  }
  const ids = normalNoteIds(sourcePart);
  if (ids.length === 0) {
    return { ok: true, package: pkg, impact: 'global' };
  }

  const scanBudget = options?.scanBudget ?? createMutationScanBudget();
  const prescanned = collectPackageNoteReferences(pkg, {
    budget: scanBudget,
    maxHits: Number.POSITIVE_INFINITY,
  });
  if (scanBudget.truncated) return fail('tree-invariant', 'reference-scan-truncated');

  let next = pkg;
  let createdPartName: string | undefined;
  let lastNoteId: number | undefined;
  const toKind: NoteKind = op.fromKind === 'footnote' ? 'endnote' : 'footnote';
  for (const noteId of ids) {
    const result = applyConvertNote(
      next,
      {
        op: 'convertNote',
        fromKind: op.fromKind,
        noteId,
      },
      undefined,
      prescanned
    );
    if (!result.ok) return result;
    next = result.package;
    if (result.createdPartName) createdPartName = result.createdPartName;
    lastNoteId = result.noteId;
  }
  return {
    ok: true,
    package: next,
    impact: 'global',
    ...(lastNoteId !== undefined ? { noteId: lastNoteId, noteKind: toKind } : {}),
    ...(createdPartName ? { createdPartName } : {}),
  };
}

// ---------------------------------------------------------------------------
// setNoteProperties
// ---------------------------------------------------------------------------

function applySetNoteProperties(
  pkg: OoxmlPackage,
  op: Extract<NoteLifecycleOp, { op: 'setNoteProperties' }>
): NoteLifecycleResult {
  if (op.scope !== 'document' && op.scope !== 'section') return fail('invalidArgs', 'scope');
  if (!op.footnote && !op.endnote) return fail('invalidArgs', 'empty');

  if (op.footnote?.position !== undefined && !isLegalFootnotePosition(op.footnote.position)) {
    return fail('invalidArgs', 'footnote-position');
  }
  if (op.endnote?.position !== undefined) {
    if (op.endnote.position === 'pageBottom' || !isLegalEndnotePosition(op.endnote.position)) {
      return fail('invalidArgs', 'endnote-pageBottom');
    }
  }
  for (const side of [op.footnote, op.endnote]) {
    if (!side) continue;
    if (side.numRestart !== undefined && !isLegalNumRestart(side.numRestart)) {
      return fail('invalidArgs', 'numRestart');
    }
    if (
      side.numFmt !== undefined &&
      (typeof side.numFmt !== 'string' || !isValidXmlText(side.numFmt))
    ) {
      return fail('invalidArgs', 'numFmt');
    }
    if (
      side.numStart !== undefined &&
      (!Number.isInteger(side.numStart) || side.numStart < 0 || side.numStart > NOTE_ID_MAX)
    ) {
      return fail('invalidArgs', 'numStart');
    }
  }

  if (op.scope === 'document') {
    const written = writeDocumentNoteProperties(pkg, op);
    if (!written) return fail('tree-invariant', 'settings-write');
    return { ok: true, package: written, impact: 'global' };
  }

  if (op.sectionIndex === undefined || !Number.isInteger(op.sectionIndex) || op.sectionIndex < 0) {
    return fail('invalidArgs', 'sectionIndex');
  }
  if (op.sectionIndex >= MAX_SECTIONS) return fail('invalidArgs', 'sectionIndex');

  const written = writeSectionNoteProperties(pkg, op.sectionIndex, op);
  if (!written) return fail('invalidArgs', 'section-write');
  return { ok: true, package: written, impact: 'global' };
}

// ---------------------------------------------------------------------------
// part creation
// ---------------------------------------------------------------------------

function ensureNotesPart(
  pkg: OoxmlPackage,
  noteKind: NoteKind
): NoteLifecycleResult & { createdPartName?: string } {
  const existing = resolveNotesPart(pkg, noteKind);
  if (existing) return { ok: true, package: pkg, impact: 'global' };

  const partName = noteKind === 'footnote' ? '/word/footnotes.xml' : '/word/endnotes.xml';
  const target = noteKind === 'footnote' ? 'footnotes.xml' : 'endnotes.xml';
  const relType = noteKind === 'footnote' ? FOOTNOTES_REL : ENDNOTES_REL;
  const contentType = noteKind === 'footnote' ? FOOTNOTES_CT : ENDNOTES_CT;
  if (pkg.parts.has(partName) || pkg.partBytes.has(partName)) {
    return fail('tree-invariant', 'part-name-collision');
  }

  const empty = emptyNotesPart(partName, contentType, noteKind);
  if (!empty) return fail('tree-invariant', 'empty-notes-part');

  let next = withPart(pkg, empty);
  const rId = freeRelationshipId(next);
  const related = withNotesRelationship(next, rId, relType, target);
  if (!related) return fail('tree-invariant', 'relationship');
  next = related;
  const typed = withContentTypeOverride(next, partName, contentType);
  if (!typed) return fail('tree-invariant', 'content-type');
  next = typed;

  return {
    ok: true,
    package: next,
    impact: 'global',
    createdPartName: partName,
  };
}

function emptyNotesPart(
  partName: string,
  contentType: string,
  noteKind: NoteKind
): OoxmlPart | null {
  const root = noteKind === 'footnote' ? 'footnotes' : 'endnotes';
  const el = noteKind === 'footnote' ? 'footnote' : 'endnote';
  const xml =
    `<w:${root} xmlns:w="${W}">` +
    `<w:${el} w:type="separator" w:id="-1">` +
    `<w:p><w:r><w:separator/></w:r></w:p>` +
    `</w:${el}>` +
    `<w:${el} w:type="continuationSeparator" w:id="0">` +
    `<w:p><w:r><w:continuationSeparator/></w:r></w:p>` +
    `</w:${el}>` +
    `</w:${root}>`;
  const read = readOoxmlPart(xml, { name: partName, contentType });
  return read.ok ? read.part : null;
}

function emptyNoteXml(noteKind: NoteKind, noteId: number): string {
  const root = noteKind === 'footnote' ? 'footnotes' : 'endnotes';
  const el = noteKind === 'footnote' ? 'footnote' : 'endnote';
  const ref = noteKind === 'footnote' ? 'footnoteRef' : 'endnoteRef';
  const style = noteKind === 'footnote' ? 'FootnoteReference' : 'EndnoteReference';
  // Engine literals only — noteId is a validated integer.
  return (
    `<w:${root} xmlns:w="${W}">` +
    `<w:${el} w:id="${noteId}">` +
    `<w:p>` +
    `<w:r><w:rPr><w:rStyle w:val="${style}"/></w:rPr><w:${ref}/></w:r>` +
    `<w:r><w:t xml:space="preserve"></w:t></w:r>` +
    `</w:p>` +
    `</w:${el}>` +
    `</w:${root}>`
  );
}

// ---------------------------------------------------------------------------
// reference / paragraph helpers
// ---------------------------------------------------------------------------

/**
 * insertNote may only target a paragraph under the main document's `w:body`.
 * Existing references in headers/footers/notes remain deletable/convertible elsewhere;
 * authoring new citations into those stories is refused atomically.
 */
function locateInsertParagraph(
  pkg: OoxmlPackage,
  paragraphId: string
):
  | { readonly ok: true; readonly partName: string; readonly paragraph: OoxmlParagraphNode }
  | {
      readonly ok: false;
      readonly detail: 'paragraph-not-found' | 'story-not-body' | 'paragraph-not-in-body';
    } {
  const main = pkg.parts.get(pkg.mainDocumentPart);
  if (main) {
    const inBody = findParagraphUnderBody(main, paragraphId);
    if (inBody) {
      return { ok: true, partName: main.name, paragraph: inBody };
    }
  }

  const budget = createNoteReferenceScanBudget();
  for (const part of pkg.parts.values()) {
    if (!part.name.endsWith('.xml')) continue;
    if (budget.parts >= budget.maxParts) break;
    budget.parts += 1;
    const node = findNode(part, paragraphId);
    if (node && node.kind === 'paragraph') {
      if (part.name === pkg.mainDocumentPart) {
        return { ok: false, detail: 'paragraph-not-in-body' };
      }
      return { ok: false, detail: 'story-not-body' };
    }
  }
  return { ok: false, detail: 'paragraph-not-found' };
}

function findBodyElement(part: OoxmlPart): OoxmlNode | null {
  for (const child of part.root.children) {
    if (child.kind === 'body') return child;
    if (
      child.kind !== 'textValue' &&
      child.namespaceUri === WML_NAMESPACE_URI &&
      child.localName === 'body'
    ) {
      return child;
    }
  }
  return null;
}

function findParagraphUnderBody(part: OoxmlPart, paragraphId: string): OoxmlParagraphNode | null {
  const body = findBodyElement(part);
  if (!body) return null;
  return findParagraphInSubtree(body, paragraphId, 0);
}

function isParagraphUnderBody(part: OoxmlPart, paragraphId: string): boolean {
  return findParagraphUnderBody(part, paragraphId) !== null;
}

function findParagraphInSubtree(
  node: OoxmlNode,
  paragraphId: string,
  depth: number
): OoxmlParagraphNode | null {
  if (depth > 64) return null;
  if (node.kind === 'paragraph' && node.id === paragraphId) return node;
  if (node.kind === 'textValue') return null;
  for (const child of node.children) {
    const found = findParagraphInSubtree(child, paragraphId, depth + 1);
    if (found) return found;
  }
  return null;
}

/** Local UTF-16 length — mirrors store `segmentsOf` without importing the store package. */
function paragraphLength(paragraph: OoxmlParagraphNode): number {
  return modelSegments(paragraph).reduce((max, segment) => Math.max(max, segment.end), 0);
}

interface ModelSegment {
  readonly runId: string;
  readonly node: OoxmlNode;
  readonly start: number;
  readonly end: number;
}

function modelSegments(paragraph: OoxmlParagraphNode): ModelSegment[] {
  const segments: ModelSegment[] = [];
  let offset = 0;
  const fieldAtoms = atomicFieldSpansOf(paragraph);
  const noteAtoms = atomicNoteSpansOf(paragraph);
  const fieldById = new Map(fieldAtoms.map((span) => [span.node.id, span]));
  const noteById = new Map(noteAtoms.map((span) => [span.node.id, span]));
  const covered = new Set<string>();
  for (const span of fieldAtoms) for (const id of span.removeNodeIds) covered.add(id);

  const emit = (runId: string, node: OoxmlNode): void => {
    segments.push({ runId, node, start: offset, end: offset + 1 });
    offset += 1;
  };

  const visit = (node: OoxmlNode, runId: string): void => {
    const field = fieldById.get(node.id);
    if (field && field.kind === 'complex') {
      emit(runId, node);
      return;
    }
    if (covered.has(node.id)) return;
    if (noteById.has(node.id) || isNoteAtomNode(node)) {
      emit(runId, node);
      return;
    }
    if (node.kind === 'textValue') {
      segments.push({ runId, node, start: offset, end: offset + node.value.length });
      offset += node.value.length;
      return;
    }
    if (node.kind === 'tab' || node.kind === 'hardBreak') {
      emit(runId, node);
      return;
    }
    // Generic / misplaced run-inner control husks contribute no atoms.
    if (node.kind === 'runProperties' || node.kind === 'generic' || isContentControl(node)) return;
    if (node.kind === 'text') {
      for (const child of node.children) visit(child, runId);
      return;
    }
    for (const child of node.children) visit(child, runId);
  };

  walkParagraphInline(paragraph.children, 0, (child) => {
    if (isFldSimple(child)) {
      const field = fieldById.get(child.id);
      if (field) emit('', child);
      return;
    }
    if (child.kind !== 'run') return;
    for (const grand of child.children) visit(grand, child.id);
  });
  return segments;
}

function noteReferenceRun(
  nextId: () => string,
  localName: 'footnoteReference' | 'endnoteReference',
  noteId: number,
  styleVal: string
): OoxmlNode {
  return {
    id: nextId(),
    kind: 'run',
    namespaceUri: W,
    localName: 'r',
    prefix: 'w',
    namespaceBindings: [],
    attributes: [],
    children: [
      {
        id: nextId(),
        kind: 'runProperties',
        namespaceUri: W,
        localName: 'rPr',
        prefix: 'w',
        namespaceBindings: [],
        attributes: [],
        children: [
          {
            id: nextId(),
            kind: 'generic',
            namespaceUri: W,
            localName: 'rStyle',
            prefix: 'w',
            namespaceBindings: [],
            attributes: [
              {
                kind: 'wmlVal',
                namespaceUri: W,
                localName: 'val',
                prefix: 'w',
                value: styleVal,
              },
            ],
            children: [],
          },
        ],
      },
      {
        id: nextId(),
        kind: 'noteReference',
        namespaceUri: W,
        localName,
        prefix: 'w',
        namespaceBindings: [],
        attributes: [
          {
            kind: 'genericExtension',
            namespaceUri: W,
            localName: 'id',
            prefix: 'w',
            value: String(noteId),
          },
        ],
        children: [],
      },
    ],
  } as unknown as OoxmlNode;
}

function insertNodesAtOffset(
  part: OoxmlPart,
  paragraph: OoxmlParagraphNode,
  offset: number,
  nodes: readonly OoxmlNode[]
): OoxmlPart | null {
  // Note references are authored as whole runs — always insert at paragraph child level.
  const segments = modelSegments(paragraph);
  const nextId = createNodeIdAllocator(part);
  const length = segments.reduce((max, segment) => Math.max(max, segment.end), 0);

  // Inside a text value: split the owning run, then place the note run between the halves.
  for (const segment of segments) {
    if (segment.node.kind !== 'textValue') continue;
    if (offset <= segment.start || offset >= segment.end) continue;
    const local = offset - segment.start;
    const value = segment.node.value;
    const textParent = findTextParent(paragraph, segment.node.id);
    if (!textParent) return null;
    const run = findNode(part, segment.runId);
    if (!run || run.kind !== 'run') return null;
    const runIndex = paragraph.children.findIndex((child) => child.id === run.id);
    if (runIndex < 0) return null;

    const headRun = {
      ...run,
      id: nextId(),
      children: run.children.flatMap((child) =>
        child.id === textParent.id ? [textElement(nextId, value.slice(0, local))] : [child]
      ),
    } as OoxmlNode;
    const tailRun = {
      ...run,
      id: nextId(),
      children: run.children.flatMap((child) =>
        child.id === textParent.id
          ? [textElement(nextId, value.slice(local))]
          : [cloneShallow(child, nextId)]
      ),
    } as OoxmlNode;
    // Remint ids inside head/tail copies so the split halves stay unique.
    const head = withFreshIds(headRun, nextId);
    const tail = withFreshIds(tailRun, nextId);
    const rebuilt = paragraph.children.flatMap((child) =>
      child.id === run.id ? [head, ...nodes, tail] : [child]
    );
    const replaced = replaceChildren(part, paragraph.id, rebuilt);
    return replaced.ok ? replaced.part : null;
  }

  if (offset === 0) {
    const pPr = paragraph.children[0]?.kind === 'paragraphProperties' ? 1 : 0;
    const inserted = insertChildren(part, paragraph.id, pPr, nodes);
    return inserted.ok ? inserted.part : null;
  }

  if (offset >= length) {
    const inserted = insertChildren(part, paragraph.id, paragraph.children.length, nodes);
    return inserted.ok ? inserted.part : null;
  }

  // Boundary between segments: insert before the run that owns the boundary start.
  const boundary = segments.find((segment) => segment.start === offset);
  if (boundary?.runId) {
    const index = paragraph.children.findIndex((child) => child.id === boundary.runId);
    if (index >= 0) {
      const inserted = insertChildren(part, paragraph.id, index, nodes);
      return inserted.ok ? inserted.part : null;
    }
  }
  if (boundary && !boundary.runId) {
    const index = paragraph.children.findIndex((child) => child.id === boundary.node.id);
    const inserted = insertChildren(part, paragraph.id, Math.max(0, index), nodes);
    return inserted.ok ? inserted.part : null;
  }

  const inserted = insertChildren(part, paragraph.id, paragraph.children.length, nodes);
  return inserted.ok ? inserted.part : null;
}

function cloneShallow(node: OoxmlNode, nextId: () => string): OoxmlNode {
  if (node.kind === 'textValue') return { ...node, id: nextId() };
  return {
    ...node,
    id: nextId(),
    children: node.children.map((child) => cloneShallow(child, nextId)),
  } as OoxmlNode;
}

function textElement(nextId: () => string, text: string): OoxmlNode {
  return {
    id: nextId(),
    kind: 'text',
    namespaceUri: W,
    localName: 't',
    prefix: 'w',
    namespaceBindings: [],
    attributes: [],
    children: [{ id: nextId(), kind: 'textValue', value: text }],
  } as unknown as OoxmlNode;
}

function findTextParent(paragraph: OoxmlParagraphNode, valueId: string): OoxmlNode | null {
  const walk = (node: OoxmlNode): OoxmlNode | null => {
    if (node.kind === 'textValue') return null;
    if (node.kind === 'text' && node.children.some((child) => child.id === valueId)) return node;
    for (const child of node.children) {
      const found = walk(child);
      if (found) return found;
    }
    return null;
  };
  return walk(paragraph);
}

/**
 * Scan every XML part under one shared budget, then remove matching references.
 * Truncation returns null without mutating `pkg`.
 */
function removeReferencesEverywhere(
  pkg: OoxmlPackage,
  noteKind: NoteKind,
  noteId: number,
  sharedBudget?: NoteReferenceScanBudget
): OoxmlPackage | null {
  const budget = sharedBudget ?? createMutationScanBudget();
  const hits = collectPackageNoteReferences(pkg, {
    budget,
    maxHits: Number.POSITIVE_INFINITY,
  }).filter((hit) => hit.noteKind === noteKind && hit.noteId === noteId);
  if (budget.truncated) return null;

  let next = pkg;
  // Apply per part so one story's edits do not invalidate another part's node ids.
  const byPart = new Map<string, string[]>();
  for (const hit of hits) {
    const list = byPart.get(hit.partName) ?? [];
    list.push(hit.nodeId);
    byPart.set(hit.partName, list);
  }
  for (const [partName, nodeIds] of byPart) {
    const current = next.parts.get(partName);
    if (!current) return null;
    let working = current;
    for (const nodeId of nodeIds) {
      if (!findNode(working, nodeId)) continue;
      const parentRun = findOwningRun(working, nodeId);
      const targetId =
        parentRun && runIsNoteReferenceOnly(parentRun, nodeId) ? parentRun.id : nodeId;
      const removed = removeNode(working, targetId);
      if (!removed.ok) return null;
      working = removed.part;
    }
    next = withPart(next, working);
  }
  return next;
}

function findOwningRun(part: OoxmlPart, nodeId: string): OoxmlElement | null {
  const stack: OoxmlNode[] = [part.root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.kind === 'textValue') continue;
    if (node.kind === 'run' && node.children.some((child) => child.id === nodeId)) {
      return node;
    }
    for (const child of node.children) stack.push(child);
  }
  return null;
}

function runIsNoteReferenceOnly(run: OoxmlElement, refId: string): boolean {
  for (const child of run.children) {
    if (child.kind === 'runProperties') continue;
    if (child.id === refId) continue;
    return false;
  }
  return true;
}

/**
 * Rewrite previously scanned reference hits. Callers must have already verified the scan
 * completed without truncation against the pre-mutation package.
 */
function rewriteReferencesEverywhere(
  pkg: OoxmlPackage,
  fromKind: NoteKind,
  toKind: NoteKind,
  toId: number,
  plannedHits: readonly { readonly partName: string; readonly nodeId: string }[]
): OoxmlPackage | null {
  let next = pkg;
  const toLocal = toKind === 'footnote' ? 'footnoteReference' : 'endnoteReference';
  const byPart = new Map<string, string[]>();
  for (const hit of plannedHits) {
    const list = byPart.get(hit.partName) ?? [];
    list.push(hit.nodeId);
    byPart.set(hit.partName, list);
  }

  for (const [partName, nodeIds] of byPart) {
    const current = next.parts.get(partName);
    if (!current) return null;
    let working = current;
    for (const nodeId of nodeIds) {
      const node = findNode(working, nodeId);
      if (!node || node.kind === 'textValue') return null;
      const replacedNode: OoxmlNode = {
        ...node,
        kind: 'noteReference',
        localName: toLocal,
        attributes: node.attributes.map((attr) =>
          attr.localName === 'id' &&
          (attr.namespaceUri === WML_NAMESPACE_URI || attr.namespaceUri === '')
            ? { ...attr, value: String(toId) }
            : attr
        ),
      } as OoxmlNode;
      const replaced = replaceNode(working, nodeId, replacedNode);
      if (!replaced.ok) return null;
      working = replaced.part;
      const parentRun = findOwningRun(working, nodeId);
      if (parentRun) {
        const styledRun = rewriteRunBuiltinNoteReferenceStyle(parentRun, fromKind, toKind);
        if (styledRun !== parentRun) {
          const runReplaced = replaceNode(working, parentRun.id, styledRun);
          if (!runReplaced.ok) return null;
          working = runReplaced.part;
        }
      }
    }
    next = withPart(next, working);
  }

  // Defensive: plannedHits may be empty when the note body exists without citations.
  return next;
}

function rewriteNoteNode(
  source: OoxmlNode,
  fromKind: NoteKind,
  toKind: NoteKind,
  newId: number,
  nextId: () => string
): OoxmlNode {
  const localName = toKind === 'footnote' ? 'footnote' : 'endnote';
  const refLocal = toKind === 'footnote' ? 'footnoteRef' : 'endnoteRef';
  const mapNode = (node: OoxmlNode): OoxmlNode => {
    if (node.kind === 'textValue') return { ...node, id: nextId() };
    let kind = node.kind;
    let name = node.localName;
    let attributes = node.attributes;
    if (node.id === source.id || (node.kind === 'note' && noteIdOf(node) === noteIdOf(source))) {
      kind = 'note';
      name = localName;
      attributes = node.attributes.map((attr) =>
        attr.localName === 'id' ? { ...attr, value: String(newId) } : attr
      );
      if (!attributes.some((attr) => attr.localName === 'id')) {
        attributes = [
          ...attributes,
          {
            kind: 'genericExtension',
            namespaceUri: W,
            localName: 'id',
            prefix: 'w',
            value: String(newId),
          },
        ];
      }
    } else if (
      node.kind === 'noteRef' ||
      (noteKindOf(node) === null &&
        (node.localName === 'footnoteRef' || node.localName === 'endnoteRef'))
    ) {
      kind = 'noteRef';
      name = refLocal;
    }
    const mappedChildren = node.children.map(mapNode);
    let result = {
      ...node,
      id: nextId(),
      kind,
      localName: name,
      attributes,
      children: mappedChildren,
    } as OoxmlNode;
    if (node.kind === 'run') {
      result = rewriteRunBuiltinNoteReferenceStyle(result, fromKind, toKind);
    }
    return result;
  };
  return mapNode(source);
}

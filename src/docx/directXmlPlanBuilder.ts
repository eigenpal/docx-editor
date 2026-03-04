/**
 * Targeted document.xml patch planning
 *
 * Builds a minimally invasive document.xml update by replacing only paragraphs
 * whose serialized content changed, keyed by stable paragraph IDs (w14:paraId / w:paraId).
 *
 * This preserves untouched OOXML structures (including unsupported revision metadata)
 * in the original XML text for high-fidelity legal workflows.
 */

import type {
  BlockContent,
  BlockSdt,
  Document,
  Endnote,
  Footnote,
  Paragraph,
  Table,
  TableCell,
} from '../types/document';
import { serializeEndnoteElement, serializeFootnoteElement } from './serializer/notesSerializer';
import { serializeParagraph } from './serializer/paragraphSerializer';

interface ParagraphSnapshot {
  paraId: string;
  xml: string;
}

export interface BuildTargetedDocumentXmlPatchResult {
  xml: string;
  changedParagraphIds: string[];
}

type NoteKind = 'footnote' | 'endnote';
type NoteModel = Footnote | Endnote;

interface NoteSnapshot {
  noteId: number;
  xml: string;
}

export interface BuildTargetedNotesXmlPatchResult {
  xml: string;
  changedNoteIds: number[];
  addedNoteIds: number[];
  removedNoteIds: number[];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getParagraphId(paragraph: Paragraph): string | null {
  return paragraph.paraId ?? null;
}

function collectParagraphSnapshotsFromTableCell(
  cell: TableCell,
  snapshots: ParagraphSnapshot[]
): void {
  for (const block of cell.content) {
    collectParagraphSnapshotsFromBlock(block, snapshots);
  }
}

function collectParagraphSnapshotsFromTable(table: Table, snapshots: ParagraphSnapshot[]): void {
  for (const row of table.rows) {
    for (const cell of row.cells) {
      collectParagraphSnapshotsFromTableCell(cell, snapshots);
    }
  }
}

function collectParagraphSnapshotsFromBlock(
  block: BlockContent,
  snapshots: ParagraphSnapshot[]
): void {
  if (block.type === 'paragraph') {
    const paraId = getParagraphId(block);
    if (!paraId) {
      return;
    }
    snapshots.push({
      paraId,
      xml: serializeParagraph(block),
    });
    return;
  }

  if (block.type === 'table') {
    collectParagraphSnapshotsFromTable(block, snapshots);
    return;
  }

  if (block.type === 'blockSdt') {
    for (const child of block.content) {
      collectParagraphSnapshotsFromBlock(child as Paragraph | Table | BlockSdt, snapshots);
    }
  }
}

function collectParagraphSnapshots(document: Document): ParagraphSnapshot[] {
  const snapshots: ParagraphSnapshot[] = [];
  for (const block of document.package.document.content) {
    collectParagraphSnapshotsFromBlock(block, snapshots);
  }
  return snapshots;
}

function hasDuplicateParagraphIds(snapshots: ParagraphSnapshot[]): boolean {
  const seen = new Set<string>();
  for (const snapshot of snapshots) {
    if (seen.has(snapshot.paraId)) {
      return true;
    }
    seen.add(snapshot.paraId);
  }
  return false;
}

function extractParagraphXmlById(documentXml: string, paraId: string): string | null {
  const escapedId = escapeRegExp(paraId);
  const pattern = new RegExp(
    `<w:p\\b(?=[^>]*\\b(?:w14:paraId|w:paraId)="${escapedId}")[\\s\\S]*?<\\/w:p>`
  );
  const match = documentXml.match(pattern);
  return match ? match[0] : null;
}

function replaceFirst(text: string, find: string, replace: string): string {
  const index = text.indexOf(find);
  if (index === -1) {
    return text;
  }
  return text.slice(0, index) + replace + text.slice(index + find.length);
}

function serializeNoteSnapshot(kind: NoteKind, note: NoteModel): NoteSnapshot {
  return {
    noteId: note.id,
    xml:
      kind === 'footnote'
        ? serializeFootnoteElement(note as Footnote)
        : serializeEndnoteElement(note as Endnote),
  };
}

function extractNoteXmlById(notesXml: string, kind: NoteKind, noteId: number): string | null {
  const escapedNoteId = escapeRegExp(String(noteId));
  const tagName = kind === 'footnote' ? 'footnote' : 'endnote';
  const pattern = new RegExp(
    `<w:${tagName}\\b(?=[^>]*\\bw:id=["']${escapedNoteId}["'])[\\s\\S]*?<\\/w:${tagName}>`
  );
  const match = notesXml.match(pattern);
  return match ? match[0] : null;
}

function insertBeforeClosingTag(xml: string, closingTag: string, fragment: string): string | null {
  const index = xml.lastIndexOf(closingTag);
  if (index < 0) return null;
  return `${xml.slice(0, index)}${fragment}${xml.slice(index)}`;
}

/**
 * Build a targeted patch for word/document.xml.
 *
 * Returns null when:
 * - document structure changed (paragraph IDs added/removed),
 * - no identifiable paragraph-level changes are detected,
 * - or a changed paragraph cannot be located in original XML.
 */
export function buildTargetedDocumentXmlPatch(args: {
  baselineDocument: Document;
  currentDocument: Document;
  baselineDocumentXml: string;
  candidateParagraphIds?: string[];
}): BuildTargetedDocumentXmlPatchResult | null {
  const { baselineDocument, currentDocument, baselineDocumentXml, candidateParagraphIds } = args;

  const baselineSnapshots = collectParagraphSnapshots(baselineDocument);
  const currentSnapshots = collectParagraphSnapshots(currentDocument);

  // Duplicate paragraph IDs make targeted replacement ambiguous because we cannot
  // deterministically map one serialized paragraph node to one raw XML node.
  // Force safe fallback to full serialization for this structure.
  if (hasDuplicateParagraphIds(baselineSnapshots) || hasDuplicateParagraphIds(currentSnapshots)) {
    return null;
  }

  const baselineById = new Map<string, ParagraphSnapshot>();
  for (const snapshot of baselineSnapshots) {
    baselineById.set(snapshot.paraId, snapshot);
  }

  const currentById = new Map<string, ParagraphSnapshot>();
  for (const snapshot of currentSnapshots) {
    currentById.set(snapshot.paraId, snapshot);
  }

  // Structural changes (paragraph insertions/deletions without full XML planner support):
  // fall back to full document serialization.
  if (baselineById.size !== currentById.size) {
    return null;
  }
  for (const paraId of baselineById.keys()) {
    if (!currentById.has(paraId)) {
      return null;
    }
  }

  const normalizedCandidates = Array.isArray(candidateParagraphIds)
    ? [...new Set(candidateParagraphIds.filter((value) => value.length > 0))]
    : [];
  const paragraphIdsToInspect =
    normalizedCandidates.length > 0 ? normalizedCandidates : [...baselineById.keys()];

  const changedParagraphIds: string[] = [];
  for (const paraId of paragraphIdsToInspect) {
    const baselineSnapshot = baselineById.get(paraId);
    const currentSnapshot = currentById.get(paraId);
    if (!baselineSnapshot || !currentSnapshot) {
      return null;
    }
    if (baselineSnapshot.xml !== currentSnapshot.xml) {
      changedParagraphIds.push(paraId);
    }
  }

  if (changedParagraphIds.length === 0) {
    return null;
  }

  let patchedXml = baselineDocumentXml;
  for (const paraId of changedParagraphIds) {
    const baselineParagraphXml = extractParagraphXmlById(patchedXml, paraId);
    if (!baselineParagraphXml) {
      return null;
    }
    const replacementXml = currentById.get(paraId)?.xml;
    if (!replacementXml) {
      return null;
    }
    patchedXml = replaceFirst(patchedXml, baselineParagraphXml, replacementXml);
  }

  if (patchedXml === baselineDocumentXml) {
    return null;
  }

  return {
    xml: patchedXml,
    changedParagraphIds,
  };
}

/**
 * Build a targeted patch for word/footnotes.xml or word/endnotes.xml.
 *
 * Only changed/added/removed note elements are touched by ID, preserving
 * all other raw OOXML in the baseline notes part.
 */
export function buildTargetedNotesXmlPatch(args: {
  kind: NoteKind;
  baselineNotes: NoteModel[];
  currentNotes: NoteModel[];
  baselineNotesXml: string;
}): BuildTargetedNotesXmlPatchResult | null {
  const { kind, baselineNotes, currentNotes, baselineNotesXml } = args;

  const baselineById = new Map<number, NoteSnapshot>();
  for (const note of baselineNotes) {
    const snapshot = serializeNoteSnapshot(kind, note);
    baselineById.set(snapshot.noteId, snapshot);
  }

  const currentById = new Map<number, NoteSnapshot>();
  for (const note of currentNotes) {
    const snapshot = serializeNoteSnapshot(kind, note);
    currentById.set(snapshot.noteId, snapshot);
  }

  const changedNoteIds: number[] = [];
  const removedNoteIds: number[] = [];
  const addedNoteIds: number[] = [];

  for (const [noteId, baselineSnapshot] of baselineById.entries()) {
    const currentSnapshot = currentById.get(noteId);
    if (!currentSnapshot) {
      removedNoteIds.push(noteId);
      continue;
    }
    if (baselineSnapshot.xml !== currentSnapshot.xml) {
      changedNoteIds.push(noteId);
    }
  }

  for (const noteId of currentById.keys()) {
    if (!baselineById.has(noteId)) {
      addedNoteIds.push(noteId);
    }
  }

  if (changedNoteIds.length === 0 && removedNoteIds.length === 0 && addedNoteIds.length === 0) {
    return null;
  }

  let patchedXml = baselineNotesXml;

  for (const noteId of changedNoteIds) {
    const baselineNoteXml = extractNoteXmlById(patchedXml, kind, noteId);
    if (!baselineNoteXml) {
      return null;
    }
    const replacementXml = currentById.get(noteId)?.xml;
    if (!replacementXml) {
      return null;
    }
    patchedXml = replaceFirst(patchedXml, baselineNoteXml, replacementXml);
  }

  for (const noteId of removedNoteIds) {
    const baselineNoteXml = extractNoteXmlById(patchedXml, kind, noteId);
    if (!baselineNoteXml) {
      return null;
    }
    patchedXml = replaceFirst(patchedXml, baselineNoteXml, '');
  }

  const addedById = new Set<number>(addedNoteIds);
  const currentOrderAddedNoteIds = currentNotes
    .map((note) => note.id)
    .filter((noteId) => addedById.has(noteId));
  const closingTag = kind === 'footnote' ? '</w:footnotes>' : '</w:endnotes>';

  for (const noteId of currentOrderAddedNoteIds) {
    const existingNoteXml = extractNoteXmlById(patchedXml, kind, noteId);
    if (existingNoteXml) {
      return null;
    }
    const newNoteXml = currentById.get(noteId)?.xml;
    if (!newNoteXml) {
      return null;
    }
    const nextXml = insertBeforeClosingTag(patchedXml, closingTag, newNoteXml);
    if (!nextXml) {
      return null;
    }
    patchedXml = nextXml;
  }

  if (patchedXml === baselineNotesXml) {
    return null;
  }

  return {
    xml: patchedXml,
    changedNoteIds,
    addedNoteIds,
    removedNoteIds,
  };
}

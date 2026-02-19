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
  Paragraph,
  Table,
  TableCell,
} from '../types/document';
import { serializeParagraph } from './serializer/paragraphSerializer';

interface ParagraphSnapshot {
  paraId: string;
  xml: string;
}

export interface BuildTargetedDocumentXmlPatchResult {
  xml: string;
  changedParagraphIds: string[];
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

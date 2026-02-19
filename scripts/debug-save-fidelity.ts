/**
 * Deep save-fidelity debugger for DOCX round-trip behavior.
 *
 * Usage:
 *   bun scripts/debug-save-fidelity.ts "/absolute/path/to/file.docx"
 */

import { readFileSync, writeFileSync } from 'node:fs';
import JSZip from 'jszip';
import { EditorState } from 'prosemirror-state';
import type { Document, HeaderFooter } from '../src/types/document';
import { parseDocx } from '../src/docx/parser';
import { serializeDocument } from '../src/docx/serializer/documentSerializer';
import { serializeHeaderFooter } from '../src/docx/serializer/headerFooterSerializer';
import { toProseDoc } from '../src/prosemirror/conversion/toProseDoc';
import { fromProseDoc } from '../src/prosemirror/conversion/fromProseDoc';
import { resolveRelativePath } from '../src/docx/relsParser';
import type { RealDocChangeOperation } from '../src/docx/realDocumentChangeStrategy';
import { applyRealDocChanges } from '../src/docx/realDocumentChangeStrategy';
import { openDocxXml } from '../src/docx/rawXmlEditor';
import { buildTargetedDocumentXmlPatch } from '../src/docx/directXmlPlanBuilder';
import { getEditedParagraphIdsFromTransaction } from '../src/prosemirror/transactionParagraphTracker';

const IMPORTANT_TAGS = [
  'w:ins',
  'w:del',
  'w:moveFrom',
  'w:moveTo',
  'w:moveFromRangeStart',
  'w:moveToRangeStart',
  'w:rPrChange',
  'w:pPrChange',
  'w:tblPrChange',
  'w:trPrChange',
  'w:tcPrChange',
  'w:sectPrChange',
  'w:object',
  'w:pict',
];

function toArrayBufferFromNodeBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

function countOccurrences(text: string, needle: string): number {
  if (!needle) return 0;
  let index = 0;
  let count = 0;
  while (true) {
    const found = text.indexOf(needle, index);
    if (found === -1) return count;
    count += 1;
    index = found + needle.length;
  }
}

function getTagCounts(xml: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const tag of IMPORTANT_TAGS) {
    counts[tag] = countOccurrences(xml, `<${tag}`);
  }
  return counts;
}

function diffCounts(
  baseline: Record<string, number>,
  current: Record<string, number>
): Record<string, number> {
  const diff: Record<string, number> = {};
  for (const tag of IMPORTANT_TAGS) {
    diff[tag] = (current[tag] ?? 0) - (baseline[tag] ?? 0);
  }
  return diff;
}

async function getDocumentXml(docxBuffer: ArrayBuffer): Promise<string> {
  const zip = await JSZip.loadAsync(docxBuffer);
  const docFile = zip.file('word/document.xml');
  if (!docFile) throw new Error('Missing word/document.xml');
  return docFile.async('text');
}

async function getChangedParts(
  baselineBuffer: ArrayBuffer,
  outputBuffer: ArrayBuffer
): Promise<string[]> {
  const baselineZip = await JSZip.loadAsync(baselineBuffer);
  const outputZip = await JSZip.loadAsync(outputBuffer);

  const partNames = new Set<string>();
  for (const [name, file] of Object.entries(baselineZip.files)) {
    if (!file.dir) partNames.add(name);
  }
  for (const [name, file] of Object.entries(outputZip.files)) {
    if (!file.dir) partNames.add(name);
  }

  const changed: string[] = [];
  for (const partName of Array.from(partNames).sort()) {
    const left = baselineZip.file(partName);
    const right = outputZip.file(partName);

    if (!left || !right) {
      changed.push(partName);
      continue;
    }

    const leftBytes = await left.async('uint8array');
    const rightBytes = await right.async('uint8array');
    if (leftBytes.length !== rightBytes.length) {
      changed.push(partName);
      continue;
    }

    let differs = false;
    for (let i = 0; i < leftBytes.length; i += 1) {
      if (leftBytes[i] !== rightBytes[i]) {
        differs = true;
        break;
      }
    }
    if (differs) {
      changed.push(partName);
    }
  }

  return changed;
}

function findFirstTextInsertPosition(pmDoc: EditorState['doc']): number | null {
  let position: number | null = null;
  pmDoc.descendants((node, pos) => {
    if (position !== null) {
      return false;
    }
    if (node.isText && typeof node.text === 'string' && node.text.length > 0) {
      position = pos + 1;
      return false;
    }
    return true;
  });
  return position;
}

function buildHeaderFooterOperations(args: {
  currentDocument: Document;
  baselineDocument: Document;
}): RealDocChangeOperation[] {
  const { currentDocument, baselineDocument } = args;
  const relationships = currentDocument.package.relationships;
  if (!relationships) return [];

  const operations: RealDocChangeOperation[] = [];
  const seenParts = new Set<string>();

  const appendOps = (
    refs: { rId: string }[] | undefined,
    currentMap: Map<string, HeaderFooter> | undefined,
    baselineMap: Map<string, HeaderFooter> | undefined
  ): void => {
    if (!refs || !currentMap) return;

    for (const ref of refs) {
      const relationship = relationships.get(ref.rId);
      const currentHeaderFooter = currentMap.get(ref.rId);
      if (!relationship || !currentHeaderFooter || relationship.targetMode === 'External') {
        continue;
      }

      const partPath = resolveRelativePath('word/_rels/document.xml.rels', relationship.target);
      if (seenParts.has(partPath)) continue;
      seenParts.add(partPath);

      const currentXml = serializeHeaderFooter(currentHeaderFooter);
      const baselineHeaderFooter = baselineMap?.get(ref.rId);
      if (baselineHeaderFooter) {
        const baselineXml = serializeHeaderFooter(baselineHeaderFooter);
        if (baselineXml === currentXml) {
          continue;
        }
      }

      operations.push({
        type: 'set-xml',
        path: partPath,
        xml: currentXml,
      });
    }
  };

  const sectionProperties = currentDocument.package.document.finalSectionProperties;
  appendOps(
    sectionProperties?.headerReferences,
    currentDocument.package.headers,
    baselineDocument.package.headers
  );
  appendOps(
    sectionProperties?.footerReferences,
    currentDocument.package.footers,
    baselineDocument.package.footers
  );
  return operations;
}

async function buildOperationsLikeApp(args: {
  currentDocument: Document;
  baselineDocument: Document;
  baselineBuffer: ArrayBuffer;
  editedParagraphIds?: string[];
}): Promise<{ operations: RealDocChangeOperation[]; targetedChangedParagraphs: number | null }> {
  const { currentDocument, baselineDocument, baselineBuffer, editedParagraphIds } = args;
  const operations: RealDocChangeOperation[] = [];
  let targetedChangedParagraphs: number | null = null;

  const currentDocumentXml = serializeDocument(currentDocument);
  const baselineDocumentXml = serializeDocument(baselineDocument);
  if (currentDocumentXml !== baselineDocumentXml) {
    let documentXmlForSave = currentDocumentXml;

    try {
      const rawEditor = await openDocxXml(baselineBuffer.slice(0));
      const rawBaselineDocumentXml = await rawEditor.getXml('word/document.xml');
      const targetedPatch = buildTargetedDocumentXmlPatch({
        baselineDocument,
        currentDocument,
        baselineDocumentXml: rawBaselineDocumentXml,
        candidateParagraphIds: editedParagraphIds,
      });
      if (targetedPatch) {
        targetedChangedParagraphs = targetedPatch.changedParagraphIds.length;
        documentXmlForSave = targetedPatch.xml;
      }
    } catch {
      // Keep full serialize fallback
    }

    operations.push({
      type: 'set-xml',
      path: 'word/document.xml',
      xml: documentXmlForSave,
    });
  }

  operations.push(...buildHeaderFooterOperations({ currentDocument, baselineDocument }));

  return { operations, targetedChangedParagraphs };
}

function summarizeTopChanges(changedParts: string[], limit = 30): string[] {
  return changedParts.slice(0, limit);
}

async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    throw new Error('Usage: bun scripts/debug-save-fidelity.ts "/absolute/path/to/file.docx"');
  }

  console.log(`Analyzing: ${inputPath}`);

  const fileBuffer = readFileSync(inputPath);
  const originalBuffer = toArrayBufferFromNodeBuffer(fileBuffer);

  const baselineDoc = await parseDocx(originalBuffer);
  if (!baselineDoc.originalBuffer) {
    throw new Error('Parsed document is missing originalBuffer');
  }
  const baselineBuffer = baselineDoc.originalBuffer.slice(0);

  const rawOriginalDocumentXml = await getDocumentXml(baselineBuffer);
  const baselineSerializedDocumentXml = serializeDocument(baselineDoc);

  const pm = toProseDoc(baselineDoc);
  const pmRoundTripDoc = fromProseDoc(pm, baselineDoc);
  const pmRoundTripDocumentXml = serializeDocument(pmRoundTripDoc);

  const pmState = EditorState.create({ doc: pm });
  const insertPos = findFirstTextInsertPosition(pmState.doc);
  if (insertPos === null) {
    throw new Error('Could not find insertion position in ProseMirror document');
  }
  const transaction = pmState.tr.insertText(' [CODX]', insertPos, insertPos);
  const pmEditedState = pmState.apply(transaction);
  const editedParagraphIds = getEditedParagraphIdsFromTransaction(transaction, pmEditedState);
  const editedDoc = fromProseDoc(pmEditedState.doc, baselineDoc);

  const { operations, targetedChangedParagraphs } = await buildOperationsLikeApp({
    currentDocument: editedDoc,
    baselineDocument: baselineDoc,
    baselineBuffer,
    editedParagraphIds,
  });
  if (operations.length === 0) {
    throw new Error('No operations produced for edited document');
  }

  const applied = await applyRealDocChanges(baselineBuffer.slice(0), operations, { strict: true });
  const savedBuffer = applied.buffer;

  const changedParts = await getChangedParts(baselineBuffer, savedBuffer);
  const savedDocumentXml = await getDocumentXml(savedBuffer);

  const report = {
    file: inputPath,
    operations: {
      count: operations.length,
      types: operations.map((op) => op.type),
      targetedChangedParagraphs,
      editedParagraphIdsCount: editedParagraphIds.length,
      editedParagraphIdsSample: editedParagraphIds.slice(0, 10),
    },
    changedParts: {
      count: changedParts.length,
      top: summarizeTopChanges(changedParts),
    },
    tagCounts: {
      rawOriginal: getTagCounts(rawOriginalDocumentXml),
      parsedSerialized: getTagCounts(baselineSerializedDocumentXml),
      pmRoundTripSerialized: getTagCounts(pmRoundTripDocumentXml),
      savedOutput: getTagCounts(savedDocumentXml),
    },
  };

  const deltas = {
    parsedVsRaw: diffCounts(report.tagCounts.rawOriginal, report.tagCounts.parsedSerialized),
    pmRoundTripVsRaw: diffCounts(
      report.tagCounts.rawOriginal,
      report.tagCounts.pmRoundTripSerialized
    ),
    savedVsRaw: diffCounts(report.tagCounts.rawOriginal, report.tagCounts.savedOutput),
  };

  const outputPath = '/tmp/docx-save-fidelity-report.json';
  writeFileSync(outputPath, JSON.stringify({ ...report, deltas }, null, 2));

  // Save generated document for optional manual inspection
  const outputDocPath = '/tmp/docx-save-fidelity-output.docx';
  writeFileSync(outputDocPath, new Uint8Array(savedBuffer));

  console.log(`Report written: ${outputPath}`);
  console.log(`Saved output:   ${outputDocPath}`);
  console.log(`Changed parts:  ${report.changedParts.count}`);
  console.log(`Ops count:      ${report.operations.count}`);
  console.log(`Targeted paras: ${report.operations.targetedChangedParagraphs ?? 'fallback/full'}`);
  console.log('Top changed parts:');
  for (const part of report.changedParts.top) {
    console.log(`  - ${part}`);
  }
  console.log('Key deltas (saved vs raw):');
  for (const tag of IMPORTANT_TAGS) {
    const delta = deltas.savedVsRaw[tag];
    if (delta !== 0) {
      console.log(`  - ${tag}: ${delta > 0 ? '+' : ''}${delta}`);
    }
  }
}

main().catch((error) => {
  console.error('debug-save-fidelity failed:', error);
  process.exit(1);
});

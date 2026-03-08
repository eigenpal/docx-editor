/**
 * Selective Save Module
 *
 * Orchestrates selective XML patching for the save flow.
 * Serializes full document.xml, validates patch safety, builds patched XML,
 * and calls updateMultipleFiles() to produce the final DOCX.
 *
 * Returns null on any failure, signaling the caller to fall back to full repack.
 */

import type { Document, BlockContent } from '../types/document';
import { serializeDocument } from './serializer/documentSerializer';
import { buildPatchedDocumentXml } from './selectiveXmlPatch';
import { updateMultipleFiles } from './rezip';

/**
 * Check if document content has new images (data: URL without rId) or
 * new hyperlinks (href without rId). Combined into a single traversal
 * to avoid walking the block tree twice.
 */
function hasNewImagesOrHyperlinks(blocks: BlockContent[]): boolean {
  for (const block of blocks) {
    if (block.type === 'paragraph') {
      for (const item of block.content) {
        if (item.type === 'run') {
          for (const c of item.content) {
            if (c.type === 'drawing' && c.image?.src?.startsWith('data:') && !c.image?.rId) {
              return true;
            }
          }
        } else if (item.type === 'hyperlink' && item.href && !item.rId && !item.anchor) {
          return true;
        }
      }
    } else if (block.type === 'table') {
      for (const row of block.rows) {
        for (const cell of row.cells) {
          if (hasNewImagesOrHyperlinks(cell.content)) return true;
        }
      }
    }
  }
  return false;
}

export interface SelectiveSaveOptions {
  /** Changed paragraph IDs to selectively patch */
  changedParaIds: Set<string>;
  /** Whether structural changes occurred (paragraph add/delete) */
  structuralChange: boolean;
  /** Whether any changes affected paragraphs without paraId */
  hasUntrackedChanges: boolean;
}

/**
 * Attempt a selective save — patch only changed paragraphs in document.xml.
 *
 * Returns the saved ArrayBuffer, or null if selective save is not possible
 * (caller should fall back to full repack).
 */
export async function attemptSelectiveSave(
  doc: Document,
  originalBuffer: ArrayBuffer,
  options: SelectiveSaveOptions
): Promise<ArrayBuffer | null> {
  const { changedParaIds, structuralChange, hasUntrackedChanges } = options;

  // Bail out conditions — fall back to full repack
  if (structuralChange) return null;
  if (hasUntrackedChanges) return null;
  if (!originalBuffer) return null;

  // Check for new images/hyperlinks that need relationship management
  const content = doc.package.document.content;
  if (hasNewImagesOrHyperlinks(content)) return null;

  // If no changes, just return the original buffer as-is
  if (changedParaIds.size === 0) {
    return originalBuffer;
  }

  try {
    // Get the original document.xml from the ZIP
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(originalBuffer);
    const docXmlFile = zip.file('word/document.xml');
    if (!docXmlFile) return null;
    const originalDocXml = await docXmlFile.async('text');

    // Serialize the full document.xml from the current document model
    const serializedDocXml = serializeDocument(doc);

    // Build the patched document.xml
    const patchedDocXml = buildPatchedDocumentXml(originalDocXml, serializedDocXml, changedParaIds);
    if (!patchedDocXml) return null;

    // Apply the patch using updateMultipleFiles
    const updates = new Map<string, string>();
    updates.set('word/document.xml', patchedDocXml);

    return await updateMultipleFiles(originalBuffer, updates);
  } catch {
    // Any error — fall back to full repack
    return null;
  }
}

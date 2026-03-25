/**
 * Selective Save Module
 *
 * Orchestrates selective XML patching for the save flow.
 * Serializes full document.xml, validates patch safety, builds patched XML,
 * and calls applyUpdatesToZip() to produce the final DOCX.
 *
 * Returns null on any failure, signaling the caller to fall back to full repack.
 */

import type { Document, BlockContent } from '../types/document';
import { serializeDocument } from './serializer/documentSerializer';
import {
  serializeCommentsWithInfo,
  serializeCommentsExtended,
} from './serializer/commentSerializer';
import { buildPatchedDocumentXml } from './selectiveXmlPatch';
import {
  applyUpdatesToZip,
  findMaxRId,
  updateCoreProperties,
  collectHeaderFooterUpdates,
  COMMENTS_CONTENT_TYPE,
  COMMENTS_EXTENDED_CONTENT_TYPE,
} from './rezip';
import { RELATIONSHIP_TYPES } from './relsParser';

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
 * Also updates comments, headers/footers, and core properties so that
 * all document parts stay in sync even when only paragraphs are patched.
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

  const comments = doc.package.document.comments;
  const hasComments = comments && comments.length > 0;
  const headerFooterUpdates = collectHeaderFooterUpdates(doc);

  try {
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(originalBuffer);
    const updates = new Map<string, string>();

    // Patch document.xml if paragraphs changed
    if (changedParaIds.size > 0) {
      const docXmlFile = zip.file('word/document.xml');
      if (!docXmlFile) return null;
      const originalDocXml = await docXmlFile.async('text');

      const serializedDocXml = serializeDocument(doc);
      const patchedDocXml = buildPatchedDocumentXml(
        originalDocXml,
        serializedDocXml,
        changedParaIds
      );
      if (!patchedDocXml) return null;
      updates.set('word/document.xml', patchedDocXml);
    }

    // Always serialize comments.xml + commentsExtended.xml when the document has comments
    if (hasComments) {
      const { xml: commentsXml, paraInfos } = serializeCommentsWithInfo(comments);
      updates.set('word/comments.xml', commentsXml);

      // Write commentsExtended.xml for reply threading (Word/Google Docs interop)
      const extendedXml = serializeCommentsExtended(paraInfos);
      if (extendedXml) {
        updates.set('word/commentsExtended.xml', extendedXml);
      }

      // Ensure [Content_Types].xml has Overrides for both comment parts
      const ctFile = zip.file('[Content_Types].xml');
      if (ctFile) {
        let ctXml = updates.get('[Content_Types].xml') ?? (await ctFile.async('text'));
        let ctChanged = false;
        if (!ctXml.includes('/word/comments.xml')) {
          ctXml = ctXml.replace(
            '</Types>',
            `<Override PartName="/word/comments.xml" ContentType="${COMMENTS_CONTENT_TYPE}"/></Types>`
          );
          ctChanged = true;
        }
        if (!ctXml.includes('/word/commentsExtended.xml')) {
          ctXml = ctXml.replace(
            '</Types>',
            `<Override PartName="/word/commentsExtended.xml" ContentType="${COMMENTS_EXTENDED_CONTENT_TYPE}"/></Types>`
          );
          ctChanged = true;
        }
        if (ctChanged) updates.set('[Content_Types].xml', ctXml);
      }

      // Ensure word/_rels/document.xml.rels has Relationships for both
      const relsPath = 'word/_rels/document.xml.rels';
      const relsFile = zip.file(relsPath);
      if (relsFile) {
        let relsXml = updates.get(relsPath) ?? (await relsFile.async('text'));
        let relsChanged = false;
        if (!relsXml.includes('comments.xml')) {
          const maxId = findMaxRId(relsXml);
          relsXml = relsXml.replace(
            '</Relationships>',
            `<Relationship Id="rId${maxId + 1}" Type="${RELATIONSHIP_TYPES.comments}" Target="comments.xml"/></Relationships>`
          );
          relsChanged = true;
        }
        if (!relsXml.includes('commentsExtended.xml')) {
          const maxId = findMaxRId(relsXml);
          relsXml = relsXml.replace(
            '</Relationships>',
            `<Relationship Id="rId${maxId + 1}" Type="${RELATIONSHIP_TYPES.commentsExtended}" Target="commentsExtended.xml"/></Relationships>`
          );
          relsChanged = true;
        }
        if (relsChanged) updates.set(relsPath, relsXml);
      }
    }

    // Serialize modified headers/footers
    for (const [path, xml] of headerFooterUpdates) {
      updates.set(path, xml);
    }

    // Update modification date in docProps/core.xml
    const corePropsFile = zip.file('docProps/core.xml');
    if (corePropsFile) {
      const corePropsXml = await corePropsFile.async('text');
      updates.set(
        'docProps/core.xml',
        updateCoreProperties(corePropsXml, { updateModifiedDate: true })
      );
    }

    // Use the already-loaded zip to avoid a redundant decompression pass
    return await applyUpdatesToZip(zip, updates);
  } catch {
    // Any error — fall back to full repack
    return null;
  }
}

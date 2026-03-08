/**
 * Selective XML Patch Module
 *
 * Patches only changed paragraphs in document.xml, preserving
 * unchanged content byte-for-byte. Uses string offset tracking
 * with proper tag depth counting (not regex) to handle nested elements.
 */

/**
 * Find the exact string start and end offsets of a <w:p> element
 * identified by its w14:paraId attribute.
 *
 * Handles nested <w:p> elements (e.g. inside mc:AlternateContent)
 * via proper depth counting.
 *
 * Returns null if paraId not found or appears more than once (ambiguous).
 */
export function findParagraphOffsets(
  xml: string,
  paraId: string
): { start: number; end: number } | null {
  // Find all <w:p elements that contain this paraId
  // We search for the opening tag pattern with this specific paraId
  const pattern = new RegExp(`<w:p[\\s>][^>]*w14:paraId="${escapeRegExp(paraId)}"`, 'g');

  const matches: number[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(xml)) !== null) {
    matches.push(match.index);
  }

  // Also check the alternative attribute order (paraId before other attrs)
  const pattern2 = new RegExp(`<w:p\\s+w14:paraId="${escapeRegExp(paraId)}"`, 'g');
  while ((match = pattern2.exec(xml)) !== null) {
    if (!matches.includes(match.index)) {
      matches.push(match.index);
    }
  }

  if (matches.length === 0) {
    return null;
  }
  if (matches.length > 1) {
    // Duplicate paraId — ambiguous, cannot safely patch
    return null;
  }

  const start = matches[0];

  // Now find the matching </w:p> by counting depth
  // Start after the <w:p opening
  let pos = start;
  let depth = 0;

  while (pos < xml.length) {
    // Find next tag
    const tagStart = xml.indexOf('<', pos);
    if (tagStart === -1) break;

    // Check if it's a <w:p or </w:p tag
    if (xml.startsWith('<w:p', tagStart)) {
      const charAfterTag = xml[tagStart + 4];
      // Must be <w:p> or <w:p or <w:p/ (not <w:pPr, <w:pStyle, etc.)
      if (charAfterTag === '>' || charAfterTag === ' ' || charAfterTag === '/') {
        // Check for self-closing: <w:p ... />
        const tagEnd = xml.indexOf('>', tagStart);
        if (tagEnd === -1) break;

        if (xml[tagEnd - 1] === '/') {
          // Self-closing <w:p ... /> — doesn't change depth
          if (depth === 0) {
            // This IS our paragraph and it's self-closing
            return { start, end: tagEnd + 1 };
          }
          pos = tagEnd + 1;
        } else {
          depth++;
          pos = tagEnd + 1;
        }
      } else {
        // It's something like <w:pPr — skip
        pos = tagStart + 1;
      }
    } else if (xml.startsWith('</w:p>', tagStart)) {
      depth--;
      if (depth === 0) {
        return { start, end: tagStart + 6 }; // 6 = '</w:p>'.length
      }
      pos = tagStart + 6;
    } else {
      pos = tagStart + 1;
    }
  }

  // Couldn't find matching close tag
  return null;
}

/**
 * Extract the serialized XML for a specific paragraph by paraId
 * from a fully serialized document.xml string.
 */
export function extractParagraphXml(serializedXml: string, paraId: string): string | null {
  const offsets = findParagraphOffsets(serializedXml, paraId);
  if (!offsets) return null;
  return serializedXml.substring(offsets.start, offsets.end);
}

/**
 * Count <w:p> elements in an XML string (top-level paragraph count).
 * Counts opening <w:p tags that are NOT self-closing.
 */
export function countParagraphElements(xml: string): number {
  let count = 0;
  const pattern = /<w:p[\s>]/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(xml)) !== null) {
    // Verify this is actually <w:p and not <w:pPr etc.
    const idx = match.index;
    const charAfter = xml[idx + 4];
    if (charAfter === '>' || charAfter === ' ') {
      count++;
    }
  }
  return count;
}

/**
 * Find all paraIds in an XML string and return counts (to detect duplicates).
 */
function collectParaIds(xml: string): Map<string, number> {
  const ids = new Map<string, number>();
  const pattern = /w14:paraId="([^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(xml)) !== null) {
    const id = match[1];
    ids.set(id, (ids.get(id) || 0) + 1);
  }
  return ids;
}

export interface PatchValidationResult {
  safe: boolean;
  reason?: string;
}

/**
 * Validate that a selective patch can be safely applied.
 *
 * Checks:
 * - All changed paraIds exist in original XML (exactly once)
 * - All changed paraIds exist in serialized XML (exactly once)
 * - Paragraph count matches between original and serialized
 */
export function validatePatchSafety(
  originalXml: string,
  serializedXml: string,
  changedIds: Set<string>
): PatchValidationResult {
  if (changedIds.size === 0) {
    return { safe: true };
  }

  const originalParaIds = collectParaIds(originalXml);
  const serializedParaIds = collectParaIds(serializedXml);

  // Check all changed IDs exist in original (exactly once)
  for (const id of changedIds) {
    const origCount = originalParaIds.get(id) || 0;
    if (origCount === 0) {
      return { safe: false, reason: `paraId-not-found-in-original: ${id}` };
    }
    if (origCount > 1) {
      return { safe: false, reason: `duplicate-paraId-in-original: ${id}` };
    }
  }

  // Check all changed IDs exist in serialized (exactly once)
  for (const id of changedIds) {
    const serCount = serializedParaIds.get(id) || 0;
    if (serCount === 0) {
      return { safe: false, reason: `paraId-not-found-in-serialized: ${id}` };
    }
    if (serCount > 1) {
      return { safe: false, reason: `duplicate-paraId-in-serialized: ${id}` };
    }
  }

  // Check paragraph counts match
  const originalCount = countParagraphElements(originalXml);
  const serializedCount = countParagraphElements(serializedXml);
  if (originalCount !== serializedCount) {
    return {
      safe: false,
      reason: `paragraph-count-mismatch: original=${originalCount}, serialized=${serializedCount}`,
    };
  }

  return { safe: true };
}

/**
 * Build a patched document.xml by splicing new paragraph XML into
 * the original at the correct offsets. Only changed paragraphs
 * are replaced; everything else is preserved byte-for-byte.
 *
 * Returns null if any step fails.
 */
export function buildPatchedDocumentXml(
  originalXml: string,
  serializedXml: string,
  changedIds: Set<string>
): string | null {
  if (changedIds.size === 0) {
    return originalXml;
  }

  // Validate safety first
  const validation = validatePatchSafety(originalXml, serializedXml, changedIds);
  if (!validation.safe) {
    return null;
  }

  // Collect all replacements: { start, end, newXml }
  const replacements: Array<{ start: number; end: number; newXml: string }> = [];

  for (const paraId of changedIds) {
    const origOffsets = findParagraphOffsets(originalXml, paraId);
    if (!origOffsets) return null;

    const newXml = extractParagraphXml(serializedXml, paraId);
    if (!newXml) return null;

    replacements.push({
      start: origOffsets.start,
      end: origOffsets.end,
      newXml,
    });
  }

  // Sort by start offset descending so we can splice end-to-start
  // (this preserves earlier offsets when replacing later sections)
  replacements.sort((a, b) => b.start - a.start);

  let result = originalXml;
  for (const { start, end, newXml } of replacements) {
    result = result.substring(0, start) + newXml + result.substring(end);
  }

  return result;
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

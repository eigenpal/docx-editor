import { D as Document, d as DocumentBody, a as Paragraph } from './agentApi-BVHzyk2l.js';

/**
 * DOCX Repacker - Repack modified document into valid DOCX
 *
 * Takes a Document with modified content and creates a new DOCX file
 * by updating document.xml while preserving all other files from
 * the original ZIP archive.
 *
 * This ensures round-trip fidelity:
 * - styles.xml, theme1.xml, fontTable.xml remain untouched
 * - Media files preserved
 * - Relationships preserved
 * - Only document.xml is updated with new content
 *
 * OOXML Package Structure:
 * - [Content_Types].xml - Content type declarations
 * - _rels/.rels - Package relationships
 * - word/document.xml - Main document (modified)
 * - word/styles.xml - Styles (preserved)
 * - word/theme/theme1.xml - Theme (preserved)
 * - word/numbering.xml - Numbering (preserved)
 * - word/fontTable.xml - Font table (preserved)
 * - word/settings.xml - Settings (preserved)
 * - word/header*.xml - Headers (preserved)
 * - word/footer*.xml - Footers (preserved)
 * - word/footnotes.xml - Footnotes (preserved)
 * - word/endnotes.xml - Endnotes (preserved)
 * - word/media/* - Media files (preserved)
 * - word/_rels/document.xml.rels - Document relationships (preserved)
 * - docProps/* - Document properties (preserved)
 */

/**
 * Options for repacking DOCX
 */
interface RepackOptions {
  /** Compression level (0-9, default: 6) */
  compressionLevel?: number;
  /** Whether to update modification date in docProps/core.xml */
  updateModifiedDate?: boolean;
  /** Custom modifier name for lastModifiedBy */
  modifiedBy?: string;
}
/**
 * Repack a Document into a valid DOCX file
 *
 * @param doc - Document with modified content
 * @param options - Optional repack options
 * @returns Promise resolving to DOCX as ArrayBuffer
 * @throws Error if document has no original buffer for round-trip
 */
declare function repackDocx(doc: Document, options?: RepackOptions): Promise<ArrayBuffer>;
/**
 * Update multiple files in a DOCX buffer
 *
 * @param originalBuffer - Original DOCX as ArrayBuffer
 * @param updates - Map of path -> content for files to update
 * @param options - Optional repack options
 * @returns Promise resolving to DOCX as ArrayBuffer
 */
declare function updateMultipleFiles(
  originalBuffer: ArrayBuffer,
  updates: Map<string, string | ArrayBuffer>,
  options?: RepackOptions
): Promise<ArrayBuffer>;
/**
 * Create a new DOCX from a Document (without requiring original buffer)
 *
 * @param doc - Document to serialize
 * @returns Promise resolving to DOCX as ArrayBuffer
 */
declare function createDocx(doc: Document): Promise<ArrayBuffer>;

interface PatchValidationResult {
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
declare function validatePatchSafety(
  originalXml: string,
  serializedXml: string,
  changedIds: Set<string>
): PatchValidationResult;
/**
 * Build a patched document.xml by splicing new paragraph XML into
 * the original at the correct offsets. Only changed paragraphs
 * are replaced; everything else is preserved byte-for-byte.
 *
 * Returns null if any step fails.
 */
declare function buildPatchedDocumentXml(
  originalXml: string,
  serializedXml: string,
  changedIds: Set<string>
): string | null;

/**
 * Variable Detector Utility
 *
 * Scans a DOCX document for template variables in the format {variable_name}
 * (standard docxtemplater syntax).
 * Returns a unique, sorted list of variable names found in the document.
 */

/**
 * Result of variable detection
 */
interface VariableDetectionResult {
  /** Unique variable names sorted alphabetically */
  variables: string[];
  /** Total count of variable occurrences */
  totalOccurrences: number;
  /** Variables by location */
  byLocation: {
    body: string[];
    headers: string[];
    footers: string[];
    footnotes: string[];
    endnotes: string[];
    textBoxes: string[];
  };
  /** Variable occurrences with positions */
  occurrences: VariableOccurrence[];
}
/**
 * A single variable occurrence with location info
 */
interface VariableOccurrence {
  /** Variable name (without braces) */
  name: string;
  /** Location type */
  location: 'body' | 'header' | 'footer' | 'footnote' | 'endnote' | 'textBox';
  /** Paragraph index within location */
  paragraphIndex?: number;
  /** Section index (for headers/footers) */
  sectionIndex?: number;
}
/**
 * Detect all template variables in a document
 *
 * @param doc - The parsed document
 * @returns Array of unique variable names sorted alphabetically
 */
declare function detectVariables(doc: Document): string[];
/**
 * Detect variables with detailed information
 *
 * @param doc - The parsed document
 * @returns Detailed detection result
 */
declare function detectVariablesDetailed(doc: Document): VariableDetectionResult;
/**
 * Detect variables in document body
 */
declare function detectVariablesInBody(body: DocumentBody): string[];
/**
 * Detect variables in a paragraph
 */
declare function detectVariablesInParagraph(paragraph: Paragraph): string[];
/**
 * Extract variable names from text
 *
 * @param text - The text to search
 * @returns Array of variable names (without braces)
 */
declare function extractVariablesFromText(text: string): string[];
/**
 * Check if text contains template variables
 */
declare function hasTemplateVariables(text: string): boolean;
/**
 * Check if a variable name is valid
 */
declare function isValidVariableName(name: string): boolean;
/**
 * Sanitize a variable name
 */
declare function sanitizeVariableName(name: string): string;
/**
 * Format a variable name with braces (standard docxtemplater syntax)
 */
declare function formatVariable(name: string): string;
/**
 * Parse a variable string to get the name
 */
declare function parseVariable(variable: string): string | null;
/**
 * Replace variables in text with values
 *
 * @param text - The text containing variables
 * @param values - Map of variable name to replacement value
 * @returns Text with variables replaced
 */
declare function replaceVariables(text: string, values: Record<string, string>): string;
/**
 * Replace all variables in text with a placeholder
 *
 * @param text - The text containing variables
 * @param placeholder - Placeholder to use (default: empty string)
 * @returns Text with variables replaced
 */
declare function removeVariables(text: string, placeholder?: string): string;
/**
 * Check if document has any template variables
 */
declare function documentHasVariables(doc: Document): boolean;

export {
  type VariableDetectionResult as V,
  type VariableOccurrence as a,
  buildPatchedDocumentXml as b,
  createDocx as c,
  detectVariables as d,
  detectVariablesDetailed as e,
  detectVariablesInBody as f,
  detectVariablesInParagraph as g,
  documentHasVariables as h,
  extractVariablesFromText as i,
  formatVariable as j,
  hasTemplateVariables as k,
  isValidVariableName as l,
  repackDocx as m,
  replaceVariables as n,
  parseVariable as p,
  removeVariables as r,
  sanitizeVariableName as s,
  updateMultipleFiles as u,
  validatePatchSafety as v,
};

/**
 * Header/Footer Serializer - Serialize headers/footers to OOXML XML
 *
 * Converts HeaderFooter objects back to valid header*.xml / footer*.xml format.
 * Reuses paragraph and table serializers for content.
 *
 * OOXML Reference:
 * - Header root: w:hdr
 * - Footer root: w:ftr
 * - Content: w:p, w:tbl (same as document body)
 */

import type { HeaderFooter, Paragraph, Table } from '../../types/document';
import { serializeParagraph } from './paragraphSerializer';
import { serializeTable } from './tableSerializer';

// Minimal namespaces needed for header/footer XML
const NAMESPACES: Record<string, string> = {
  wpc: 'http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas',
  mc: 'http://schemas.openxmlformats.org/markup-compatibility/2006',
  o: 'urn:schemas-microsoft-com:office:office',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  m: 'http://schemas.openxmlformats.org/officeDocument/2006/math',
  v: 'urn:schemas-microsoft-com:vml',
  wp14: 'http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing',
  wp: 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
  w10: 'urn:schemas-microsoft-com:office:word',
  w: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  w14: 'http://schemas.microsoft.com/office/word/2010/wordml',
  w15: 'http://schemas.microsoft.com/office/word/2012/wordml',
  wpg: 'http://schemas.microsoft.com/office/word/2010/wordprocessingGroup',
  wps: 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape',
};

function buildNamespaceDeclarations(): string {
  return Object.entries(NAMESPACES)
    .map(([prefix, uri]) => `xmlns:${prefix}="${uri}"`)
    .join(' ');
}

/**
 * Serialize a block content item (paragraph or table) for header/footer
 */
function serializeBlock(block: Paragraph | Table): string {
  if (block.type === 'paragraph') {
    return serializeParagraph(block);
  } else if (block.type === 'table') {
    return serializeTable(block);
  }
  return '';
}

/**
 * Serialize a HeaderFooter object to valid OOXML XML
 *
 * @param hf - HeaderFooter object to serialize
 * @returns Complete XML string for header*.xml or footer*.xml
 */
export function serializeHeaderFooter(hf: HeaderFooter): string {
  const rootTag = hf.type === 'header' ? 'w:hdr' : 'w:ftr';
  const nsDecl = buildNamespaceDeclarations();

  // Serialize content blocks
  let contentXml = hf.content.map((block) => serializeBlock(block)).join('');

  // Ensure at least one empty paragraph (required by OOXML spec)
  if (!contentXml) {
    contentXml = '<w:p><w:pPr/></w:p>';
  }

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<${rootTag} ${nsDecl}>${contentXml}</${rootTag}>`;
}

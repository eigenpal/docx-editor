/**
 * Footnotes/Endnotes Serializer - Serialize notes parts to OOXML XML
 *
 * Converts parsed footnotes/endnotes back to valid word/footnotes.xml and
 * word/endnotes.xml payloads for direct-XML save planning.
 */

import type { Endnote, Footnote, Paragraph } from '../../types/document';
import { serializeParagraph } from './paragraphSerializer';

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

function serializeNoteParagraphs(paragraphs: Paragraph[]): string {
  const serialized = paragraphs.map((paragraph) => serializeParagraph(paragraph)).join('');
  if (serialized) return serialized;
  return '<w:p><w:pPr/></w:p>';
}

function maybeSerializeNoteType(
  noteType: 'normal' | 'separator' | 'continuationSeparator' | 'continuationNotice' | undefined
): string {
  if (!noteType || noteType === 'normal') return '';
  return ` w:type="${noteType}"`;
}

export function serializeFootnoteElement(note: Footnote): string {
  const typeAttr = maybeSerializeNoteType(note.noteType);
  return `<w:footnote w:id="${note.id}"${typeAttr}>${serializeNoteParagraphs(note.content)}</w:footnote>`;
}

export function serializeEndnoteElement(note: Endnote): string {
  const typeAttr = maybeSerializeNoteType(note.noteType);
  return `<w:endnote w:id="${note.id}"${typeAttr}>${serializeNoteParagraphs(note.content)}</w:endnote>`;
}

export function serializeFootnotes(footnotes: Footnote[]): string {
  const nsDecl = buildNamespaceDeclarations();
  const body = footnotes.map((note) => serializeFootnoteElement(note)).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:footnotes ${nsDecl}>${body}</w:footnotes>`;
}

export function serializeEndnotes(endnotes: Endnote[]): string {
  const nsDecl = buildNamespaceDeclarations();
  const body = endnotes.map((note) => serializeEndnoteElement(note)).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:endnotes ${nsDecl}>${body}</w:endnotes>`;
}

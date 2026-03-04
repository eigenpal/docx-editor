import JSZip from 'jszip';
import type { Document, Paragraph, Table, BlockContent } from '../../src/types/document';

export async function extractDocumentXml(buffer: ArrayBuffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const documentXml = zip.file('word/document.xml');
  if (!documentXml) {
    throw new Error('word/document.xml not found in exported DOCX');
  }
  return documentXml.async('text');
}

export function createTextParagraph(text: string): Paragraph {
  return {
    type: 'paragraph',
    content: [
      {
        type: 'run',
        content: [{ type: 'text', text }],
      },
    ],
  };
}

export function createTable(cellTexts: string[][]): Table {
  return {
    type: 'table',
    rows: cellTexts.map((rowTexts) => ({
      type: 'tableRow' as const,
      cells: rowTexts.map((text) => ({
        type: 'tableCell' as const,
        content: [createTextParagraph(text)],
      })),
    })),
  };
}

export function createBaselineSnapshot(
  originalBuffer: ArrayBuffer,
  paragraphText: string
): Document['baselineDocument'] {
  return {
    package: {
      document: {
        content: [createTextParagraph(paragraphText)],
      },
    },
    originalBuffer,
  };
}

export function createBaselineFromBlocks(
  originalBuffer: ArrayBuffer,
  blocks: BlockContent[]
): Document['baselineDocument'] {
  return {
    package: {
      document: {
        content: blocks,
      },
    },
    originalBuffer,
  };
}

import { describe, expect, test } from 'bun:test';
import type { Document, Paragraph } from '../types/document';
import { serializeParagraph } from './serializer/paragraphSerializer';
import { buildTargetedDocumentXmlPatch } from './directXmlPlanBuilder';

function paragraph(paraId: string, text: string): Paragraph {
  return {
    type: 'paragraph',
    paraId,
    content: [
      {
        type: 'run',
        content: [{ type: 'text', text }],
      },
    ],
  };
}

function documentWithParagraphs(paragraphs: Paragraph[]): Document {
  return {
    package: {
      document: {
        content: paragraphs,
      },
    },
  };
}

function wrapDocumentXml(paragraphXml: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"><w:body>${paragraphXml}</w:body></w:document>`;
}

describe('buildTargetedDocumentXmlPatch', () => {
  test('replaces only changed paragraph and preserves untouched unsupported XML', () => {
    const baselineP1 = paragraph('AAAA1111', 'Keep me');
    const baselineP2 = paragraph('BBBB2222', 'Old value');
    const currentP1 = paragraph('AAAA1111', 'Keep me');
    const currentP2 = paragraph('BBBB2222', 'New value');

    const baseline = documentWithParagraphs([baselineP1, baselineP2]);
    const current = documentWithParagraphs([currentP1, currentP2]);

    const baselineP1Xml = serializeParagraph(baselineP1).replace(
      '</w:p>',
      '<w:pPrChange w:id="7"><w:pPr/></w:pPrChange></w:p>'
    );
    const baselineDocumentXml = wrapDocumentXml(
      `${baselineP1Xml}${serializeParagraph(baselineP2)}`
    );

    const result = buildTargetedDocumentXmlPatch({
      baselineDocument: baseline,
      currentDocument: current,
      baselineDocumentXml,
    });

    expect(result).not.toBeNull();
    if (!result) return;

    expect(result.changedParagraphIds).toEqual(['BBBB2222']);
    expect(result.xml).toContain('w:pPrChange');
    expect(result.xml).toContain('New value');
    expect(result.xml).toContain('Keep me');
  });

  test('returns null when paragraph IDs changed (structural edit)', () => {
    const baseline = documentWithParagraphs([paragraph('AAAA1111', 'A')]);
    const current = documentWithParagraphs([
      paragraph('AAAA1111', 'A'),
      paragraph('BBBB2222', 'B'),
    ]);
    const baselineDocumentXml = wrapDocumentXml(serializeParagraph(paragraph('AAAA1111', 'A')));

    const result = buildTargetedDocumentXmlPatch({
      baselineDocument: baseline,
      currentDocument: current,
      baselineDocumentXml,
    });

    expect(result).toBeNull();
  });

  test('returns null when changed paragraph cannot be found in baseline XML', () => {
    const baseline = documentWithParagraphs([paragraph('AAAA1111', 'A')]);
    const current = documentWithParagraphs([paragraph('AAAA1111', 'B')]);
    const baselineDocumentXml = wrapDocumentXml('<w:p><w:r><w:t>No para id here</w:t></w:r></w:p>');

    const result = buildTargetedDocumentXmlPatch({
      baselineDocument: baseline,
      currentDocument: current,
      baselineDocumentXml,
    });

    expect(result).toBeNull();
  });

  test('uses candidate paragraph IDs to avoid unrelated serializer noise', () => {
    const baselineP1 = paragraph('AAAA1111', 'Alpha');
    const baselineP2 = paragraph('BBBB2222', 'Beta');
    const currentP1 = paragraph('AAAA1111', 'Alpha updated');
    const currentP2 = paragraph('BBBB2222', 'Beta updated');

    const baseline = documentWithParagraphs([baselineP1, baselineP2]);
    const current = documentWithParagraphs([currentP1, currentP2]);
    const baselineDocumentXml = wrapDocumentXml(
      `${serializeParagraph(baselineP1)}${serializeParagraph(baselineP2)}`
    );

    const result = buildTargetedDocumentXmlPatch({
      baselineDocument: baseline,
      currentDocument: current,
      baselineDocumentXml,
      candidateParagraphIds: ['BBBB2222'],
    });

    expect(result).not.toBeNull();
    if (!result) return;

    expect(result.changedParagraphIds).toEqual(['BBBB2222']);
    expect(result.xml).toContain('Alpha');
    expect(result.xml).toContain('Beta updated');
    expect(result.xml).not.toContain('Alpha updated');
  });
});

import { describe, expect, test } from 'bun:test';
import type { Document, Footnote, Paragraph } from '../types/document';
import { serializeParagraph } from './serializer/paragraphSerializer';
import { buildTargetedDocumentXmlPatch, buildTargetedNotesXmlPatch } from './directXmlPlanBuilder';

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

  test('returns null when baseline has duplicate paragraph IDs', () => {
    const baselineP1 = paragraph('AAAA1111', 'First baseline');
    const baselineP2 = paragraph('AAAA1111', 'Second baseline');
    const currentP = paragraph('AAAA1111', 'Single current');
    const baseline = documentWithParagraphs([baselineP1, baselineP2]);
    const current = documentWithParagraphs([currentP]);
    const baselineDocumentXml = wrapDocumentXml(
      `${serializeParagraph(baselineP1)}${serializeParagraph(baselineP2)}`
    );

    const result = buildTargetedDocumentXmlPatch({
      baselineDocument: baseline,
      currentDocument: current,
      baselineDocumentXml,
    });

    expect(result).toBeNull();
  });

  test('returns null when current has duplicate paragraph IDs', () => {
    const baselineP = paragraph('AAAA1111', 'Single baseline');
    const currentP1 = paragraph('AAAA1111', 'First current');
    const currentP2 = paragraph('AAAA1111', 'Second current');
    const baseline = documentWithParagraphs([baselineP]);
    const current = documentWithParagraphs([currentP1, currentP2]);
    const baselineDocumentXml = wrapDocumentXml(serializeParagraph(baselineP));

    const result = buildTargetedDocumentXmlPatch({
      baselineDocument: baseline,
      currentDocument: current,
      baselineDocumentXml,
    });

    expect(result).toBeNull();
  });
});

function footnote(id: number, text: string): Footnote {
  return {
    type: 'footnote',
    id,
    noteType: 'normal',
    content: [paragraph(`FFFF${String(id).padStart(4, '0')}`, text)],
  };
}

describe('buildTargetedNotesXmlPatch', () => {
  test('preserves separator and continuation notes while replacing changed normal note', () => {
    const baselineNotes = [footnote(1, 'Old note text')];
    const currentNotes = [footnote(1, 'New note text')];
    const baselineNotesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:t>SEP-MARKER</w:t></w:r></w:p><w:customSep data-x="1"/></w:footnote>
  <w:footnote w:id="1"><w:p><w:r><w:t>Old note text</w:t></w:r></w:p></w:footnote>
  <w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:t>CONT-MARKER</w:t></w:r></w:p></w:footnote>
</w:footnotes>`;

    const result = buildTargetedNotesXmlPatch({
      kind: 'footnote',
      baselineNotes,
      currentNotes,
      baselineNotesXml,
    });

    expect(result).not.toBeNull();
    if (!result) return;

    expect(result.changedNoteIds).toEqual([1]);
    expect(result.xml).toContain('New note text');
    expect(result.xml).not.toContain('Old note text');
    expect(result.xml).toContain('SEP-MARKER');
    expect(result.xml).toContain('CONT-MARKER');
    expect(result.xml).toContain('customSep');
  });

  test('adds new note element without rewriting untouched note XML', () => {
    const baselineNotes = [footnote(1, 'First note')];
    const currentNotes = [footnote(1, 'First note'), footnote(2, 'Second note')];
    const baselineNotesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:t>SEP-MARKER</w:t></w:r></w:p></w:footnote>
  <w:footnote w:id="1"><w:p><w:r><w:t>First note</w:t></w:r></w:p></w:footnote>
</w:footnotes>`;

    const result = buildTargetedNotesXmlPatch({
      kind: 'footnote',
      baselineNotes,
      currentNotes,
      baselineNotesXml,
    });

    expect(result).not.toBeNull();
    if (!result) return;

    expect(result.addedNoteIds).toEqual([2]);
    expect(result.xml).toContain('SEP-MARKER');
    expect(result.xml).toContain('<w:footnote w:id="2">');
    expect(result.xml).toContain('Second note');
  });

  test('removes deleted note element and keeps special notes', () => {
    const baselineNotes = [footnote(1, 'First note'), footnote(2, 'Second note')];
    const currentNotes = [footnote(1, 'First note')];
    const baselineNotesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:t>SEP-MARKER</w:t></w:r></w:p></w:footnote>
  <w:footnote w:id="1"><w:p><w:r><w:t>First note</w:t></w:r></w:p></w:footnote>
  <w:footnote w:id="2"><w:p><w:r><w:t>Second note</w:t></w:r></w:p></w:footnote>
</w:footnotes>`;

    const result = buildTargetedNotesXmlPatch({
      kind: 'footnote',
      baselineNotes,
      currentNotes,
      baselineNotesXml,
    });

    expect(result).not.toBeNull();
    if (!result) return;

    expect(result.removedNoteIds).toEqual([2]);
    expect(result.xml).toContain('SEP-MARKER');
    expect(result.xml).toContain('<w:footnote w:id="1">');
    expect(result.xml).not.toContain('<w:footnote w:id="2">');
  });
});

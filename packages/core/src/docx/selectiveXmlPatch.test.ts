/**
 * Unit tests for selectiveXmlPatch
 */

import { describe, test, expect } from 'bun:test';
import {
  findParagraphOffsets,
  extractParagraphXml,
  validatePatchSafety,
  buildPatchedDocumentXml,
  countParagraphElements,
} from './selectiveXmlPatch';

// ============================================================================
// Test XML fixtures
// ============================================================================

const SIMPLE_DOC = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">
<w:body>
<w:p w14:paraId="AAA111" w14:textId="T1"><w:pPr><w:jc w:val="left"/></w:pPr><w:r><w:t>First paragraph</w:t></w:r></w:p>
<w:p w14:paraId="BBB222" w14:textId="T2"><w:r><w:t>Second paragraph</w:t></w:r></w:p>
<w:p w14:paraId="CCC333" w14:textId="T3"><w:r><w:t>Third paragraph</w:t></w:r></w:p>
</w:body>
</w:document>`;

const DOC_WITH_MC = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006">
<w:body>
<w:p w14:paraId="OUTER1" w14:textId="T1"><mc:AlternateContent><mc:Choice Requires="wps"><w:p w14:paraId="INNER1"><w:r><w:t>Inner</w:t></w:r></w:p></mc:Choice><mc:Fallback><w:p w14:paraId="INNER2"><w:r><w:t>Fallback</w:t></w:r></w:p></mc:Fallback></mc:AlternateContent></w:p>
<w:p w14:paraId="NORMAL1" w14:textId="T2"><w:r><w:t>Normal paragraph</w:t></w:r></w:p>
</w:body>
</w:document>`;

const DOC_WITH_DUPLICATE_ID = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">
<w:body>
<w:p w14:paraId="DUP001" w14:textId="T1"><w:r><w:t>First</w:t></w:r></w:p>
<w:p w14:paraId="DUP001" w14:textId="T2"><w:r><w:t>Duplicate</w:t></w:r></w:p>
</w:body>
</w:document>`;

const DOC_WITH_MANY_ATTRS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">
<w:body>
<w:p w:rsidR="00A12345" w:rsidRDefault="00B67890" w14:paraId="ATTR01" w14:textId="TXID01" w:rsidP="00C11111"><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Heading</w:t></w:r></w:p>
</w:body>
</w:document>`;

// ============================================================================
// findParagraphOffsets
// ============================================================================

describe('findParagraphOffsets', () => {
  test('finds a simple paragraph by paraId', () => {
    const offsets = findParagraphOffsets(SIMPLE_DOC, 'AAA111');
    expect(offsets).not.toBeNull();
    const extracted = SIMPLE_DOC.substring(offsets!.start, offsets!.end);
    expect(extracted).toStartWith('<w:p w14:paraId="AAA111"');
    expect(extracted).toEndWith('</w:p>');
    expect(extracted).toContain('First paragraph');
  });

  test('finds the second paragraph', () => {
    const offsets = findParagraphOffsets(SIMPLE_DOC, 'BBB222');
    expect(offsets).not.toBeNull();
    const extracted = SIMPLE_DOC.substring(offsets!.start, offsets!.end);
    expect(extracted).toContain('Second paragraph');
  });

  test('finds the third paragraph', () => {
    const offsets = findParagraphOffsets(SIMPLE_DOC, 'CCC333');
    expect(offsets).not.toBeNull();
    const extracted = SIMPLE_DOC.substring(offsets!.start, offsets!.end);
    expect(extracted).toContain('Third paragraph');
  });

  test('returns null for missing paraId', () => {
    expect(findParagraphOffsets(SIMPLE_DOC, 'MISSING')).toBeNull();
  });

  test('returns null for duplicate paraId', () => {
    expect(findParagraphOffsets(DOC_WITH_DUPLICATE_ID, 'DUP001')).toBeNull();
  });

  test('handles nested w:p inside mc:AlternateContent', () => {
    // The outer paragraph should encompass all nested content
    const offsets = findParagraphOffsets(DOC_WITH_MC, 'OUTER1');
    expect(offsets).not.toBeNull();
    const extracted = DOC_WITH_MC.substring(offsets!.start, offsets!.end);
    expect(extracted).toStartWith('<w:p w14:paraId="OUTER1"');
    expect(extracted).toEndWith('</w:p>');
    // Should contain the nested mc:AlternateContent
    expect(extracted).toContain('mc:AlternateContent');
    expect(extracted).toContain('INNER1');
    expect(extracted).toContain('INNER2');
  });

  test('finds normal paragraph after mc:AlternateContent block', () => {
    const offsets = findParagraphOffsets(DOC_WITH_MC, 'NORMAL1');
    expect(offsets).not.toBeNull();
    const extracted = DOC_WITH_MC.substring(offsets!.start, offsets!.end);
    expect(extracted).toContain('Normal paragraph');
    expect(extracted).not.toContain('mc:AlternateContent');
  });

  test('finds paragraph with many attributes', () => {
    const offsets = findParagraphOffsets(DOC_WITH_MANY_ATTRS, 'ATTR01');
    expect(offsets).not.toBeNull();
    const extracted = DOC_WITH_MANY_ATTRS.substring(offsets!.start, offsets!.end);
    expect(extracted).toContain('Heading');
    expect(extracted).toContain('w:rsidR="00A12345"');
  });

  test('handles self-closing paragraph tag', () => {
    const xml = '<w:body><w:p w14:paraId="SELF01"/></w:body>';
    const offsets = findParagraphOffsets(xml, 'SELF01');
    expect(offsets).not.toBeNull();
    const extracted = xml.substring(offsets!.start, offsets!.end);
    expect(extracted).toBe('<w:p w14:paraId="SELF01"/>');
  });
});

// ============================================================================
// extractParagraphXml
// ============================================================================

describe('extractParagraphXml', () => {
  test('extracts a paragraph by paraId', () => {
    const xml = extractParagraphXml(SIMPLE_DOC, 'BBB222');
    expect(xml).not.toBeNull();
    expect(xml).toContain('Second paragraph');
    expect(xml).toStartWith('<w:p');
    expect(xml).toEndWith('</w:p>');
  });

  test('returns null for missing paraId', () => {
    expect(extractParagraphXml(SIMPLE_DOC, 'NOPE')).toBeNull();
  });
});

// ============================================================================
// countParagraphElements
// ============================================================================

describe('countParagraphElements', () => {
  test('counts paragraphs in simple doc', () => {
    expect(countParagraphElements(SIMPLE_DOC)).toBe(3);
  });

  test('counts all w:p elements including nested ones', () => {
    // OUTER1 + INNER1 + INNER2 + NORMAL1 = 4
    expect(countParagraphElements(DOC_WITH_MC)).toBe(4);
  });

  test('does not count w:pPr or w:pStyle as paragraphs', () => {
    const xml =
      '<w:body><w:p w14:paraId="X"><w:pPr><w:pStyle w:val="Normal"/></w:pPr></w:p></w:body>';
    expect(countParagraphElements(xml)).toBe(1);
  });
});

// ============================================================================
// validatePatchSafety
// ============================================================================

describe('validatePatchSafety', () => {
  test('safe when all changed IDs exist in both XMLs', () => {
    const result = validatePatchSafety(SIMPLE_DOC, SIMPLE_DOC, new Set(['AAA111']));
    expect(result.safe).toBe(true);
  });

  test('safe with empty changed set', () => {
    const result = validatePatchSafety(SIMPLE_DOC, SIMPLE_DOC, new Set());
    expect(result.safe).toBe(true);
  });

  test('unsafe when paraId not found in original', () => {
    const result = validatePatchSafety(SIMPLE_DOC, SIMPLE_DOC, new Set(['MISSING']));
    expect(result.safe).toBe(false);
    expect(result.reason).toContain('paraId-not-found-in-original');
  });

  test('unsafe when paraId not found in serialized', () => {
    const serializedWithout = SIMPLE_DOC.replace('AAA111', 'NEWID1');
    const result = validatePatchSafety(SIMPLE_DOC, serializedWithout, new Set(['AAA111']));
    expect(result.safe).toBe(false);
    expect(result.reason).toContain('paraId-not-found-in-serialized');
  });

  test('unsafe when duplicate paraId in original', () => {
    const result = validatePatchSafety(
      DOC_WITH_DUPLICATE_ID,
      DOC_WITH_DUPLICATE_ID,
      new Set(['DUP001'])
    );
    expect(result.safe).toBe(false);
    expect(result.reason).toContain('duplicate-paraId-in-original');
  });

  test('unsafe when paragraph count mismatch', () => {
    // Add an extra paragraph to serialized
    const serializedExtra = SIMPLE_DOC.replace(
      '</w:body>',
      '<w:p w14:paraId="DDD444"><w:r><w:t>Extra</w:t></w:r></w:p></w:body>'
    );
    const result = validatePatchSafety(SIMPLE_DOC, serializedExtra, new Set(['AAA111']));
    expect(result.safe).toBe(false);
    expect(result.reason).toContain('paragraph-count-mismatch');
  });
});

// ============================================================================
// buildPatchedDocumentXml
// ============================================================================

describe('buildPatchedDocumentXml', () => {
  test('returns original XML when no changes', () => {
    const result = buildPatchedDocumentXml(SIMPLE_DOC, SIMPLE_DOC, new Set());
    expect(result).toBe(SIMPLE_DOC);
  });

  test('replaces a single paragraph', () => {
    // Create a "serialized" version where the first paragraph has different text
    const serialized = SIMPLE_DOC.replace('First paragraph', 'MODIFIED paragraph');
    const result = buildPatchedDocumentXml(SIMPLE_DOC, serialized, new Set(['AAA111']));

    expect(result).not.toBeNull();
    // Changed paragraph should have new content
    expect(result).toContain('MODIFIED paragraph');
    // Unchanged paragraphs should be byte-for-byte identical
    expect(result).toContain('Second paragraph');
    expect(result).toContain('Third paragraph');
  });

  test('replaces multiple paragraphs', () => {
    const serialized = SIMPLE_DOC.replace('First paragraph', 'MODIFIED first').replace(
      'Third paragraph',
      'MODIFIED third'
    );
    const result = buildPatchedDocumentXml(SIMPLE_DOC, serialized, new Set(['AAA111', 'CCC333']));

    expect(result).not.toBeNull();
    expect(result).toContain('MODIFIED first');
    expect(result).toContain('Second paragraph'); // unchanged
    expect(result).toContain('MODIFIED third');
  });

  test('handles replacement with longer XML', () => {
    const serialized = SIMPLE_DOC.replace(
      '<w:r><w:t>First paragraph</w:t></w:r>',
      '<w:r><w:rPr><w:b/></w:rPr><w:t>Much longer first paragraph with bold formatting and extra content</w:t></w:r>'
    );
    const result = buildPatchedDocumentXml(SIMPLE_DOC, serialized, new Set(['AAA111']));

    expect(result).not.toBeNull();
    expect(result).toContain('Much longer first paragraph');
    expect(result).toContain('Second paragraph');
  });

  test('handles replacement with shorter XML', () => {
    const serialized = SIMPLE_DOC.replace(
      '<w:pPr><w:jc w:val="left"/></w:pPr><w:r><w:t>First paragraph</w:t></w:r>',
      '<w:r><w:t>Hi</w:t></w:r>'
    );
    const result = buildPatchedDocumentXml(SIMPLE_DOC, serialized, new Set(['AAA111']));

    expect(result).not.toBeNull();
    expect(result).toContain('Hi');
    expect(result).toContain('Second paragraph');
  });

  test('returns null when paraId missing from original', () => {
    const result = buildPatchedDocumentXml(SIMPLE_DOC, SIMPLE_DOC, new Set(['MISSING']));
    expect(result).toBeNull();
  });

  test('returns null when paragraph count mismatch', () => {
    const serializedExtra = SIMPLE_DOC.replace(
      '</w:body>',
      '<w:p w14:paraId="DDD444"><w:r><w:t>Extra</w:t></w:r></w:p></w:body>'
    );
    const result = buildPatchedDocumentXml(SIMPLE_DOC, serializedExtra, new Set(['AAA111']));
    expect(result).toBeNull();
  });

  test('preserves bytes around unchanged paragraphs exactly', () => {
    const serialized = SIMPLE_DOC.replace('Second paragraph', 'CHANGED second');
    const result = buildPatchedDocumentXml(SIMPLE_DOC, serialized, new Set(['BBB222']));
    expect(result).not.toBeNull();

    // Extract the part before the changed paragraph — should be identical
    const origBeforeBBB = SIMPLE_DOC.substring(0, SIMPLE_DOC.indexOf('<w:p w14:paraId="BBB222"'));
    const resultBeforeBBB = result!.substring(0, result!.indexOf('<w:p w14:paraId="BBB222"'));
    expect(resultBeforeBBB).toBe(origBeforeBBB);

    // Extract the part after the changed paragraph
    const origAfterBBB = SIMPLE_DOC.substring(SIMPLE_DOC.indexOf('<w:p w14:paraId="CCC333"'));
    const resultAfterBBB = result!.substring(result!.indexOf('<w:p w14:paraId="CCC333"'));
    expect(resultAfterBBB).toBe(origAfterBBB);
  });
});

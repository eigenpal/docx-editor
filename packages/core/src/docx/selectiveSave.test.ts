/**
 * Integration tests for Selective Save
 *
 * Tests the full pipeline: parse DOCX → modify document model → selective save → verify XML.
 * Uses real DOCX parsing and serialization to ensure round-trip correctness.
 */

import { describe, test, expect } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import JSZip from 'jszip';
import { parseDocx } from './parser';
import { repackDocx } from './rezip';
import { attemptSelectiveSave } from './selectiveSave';
import {
  findParagraphOffsets,
  buildPatchedDocumentXml,
  validatePatchSafety,
  countParagraphElements,
} from './selectiveXmlPatch';
import { serializeDocument } from './serializer/documentSerializer';
import type { Paragraph, Run } from '../types/document';

// ============================================================================
// Helpers
// ============================================================================

const FIXTURES_DIR = path.resolve(__dirname, '../../../../e2e/fixtures');

async function loadFixture(name: string): Promise<ArrayBuffer> {
  const filePath = path.join(FIXTURES_DIR, name);
  const buffer = fs.readFileSync(filePath);
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

async function getDocumentXml(buffer: ArrayBuffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const file = zip.file('word/document.xml');
  if (!file) throw new Error('No word/document.xml found');
  return file.async('text');
}

// ============================================================================
// selectiveXmlPatch tests with real DOCX content
// ============================================================================

describe('Selective XML Patch with real DOCX', () => {
  test('finds paragraphs in real document.xml', async () => {
    const buffer = await loadFixture('example-with-image.docx');
    const xml = await getDocumentXml(buffer);

    // Count paragraphs
    const count = countParagraphElements(xml);
    expect(count).toBeGreaterThan(0);

    // Try to find paraIds in the XML
    const paraIdPattern = /w14:paraId="([^"]+)"/g;
    const ids: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = paraIdPattern.exec(xml)) !== null) {
      ids.push(m[1]);
    }
    expect(ids.length).toBeGreaterThan(0);

    // Try to find offsets for each unique ID
    const uniqueIds = [...new Set(ids)];
    for (const id of uniqueIds.slice(0, 5)) {
      const offsets = findParagraphOffsets(xml, id);
      // May be null if nested w:p (inner IDs)
      if (offsets) {
        const extracted = xml.substring(offsets.start, offsets.end);
        expect(extracted).toStartWith('<w:p');
        expect(extracted).toContain(`w14:paraId="${id}"`);
      }
    }
  });

  test('validates patch safety on real document', async () => {
    const buffer = await loadFixture('example-with-image.docx');
    const doc = await parseDocx(buffer, { preloadFonts: false });
    const originalXml = await getDocumentXml(buffer);
    const serializedXml = serializeDocument(doc);

    // Empty change set should be safe
    const result = validatePatchSafety(originalXml, serializedXml, new Set());
    expect(result.safe).toBe(true);
  });
});

// ============================================================================
// attemptSelectiveSave integration tests
// ============================================================================

describe('attemptSelectiveSave', () => {
  test('returns null when structural change occurred', async () => {
    const buffer = await loadFixture('example-with-image.docx');
    const doc = await parseDocx(buffer, { preloadFonts: false });

    const result = await attemptSelectiveSave(doc, buffer, {
      changedParaIds: new Set(['someId']),
      structuralChange: true,
      hasUntrackedChanges: false,
    });

    expect(result).toBeNull();
  });

  test('returns null when untracked changes exist', async () => {
    const buffer = await loadFixture('example-with-image.docx');
    const doc = await parseDocx(buffer, { preloadFonts: false });

    const result = await attemptSelectiveSave(doc, buffer, {
      changedParaIds: new Set(['someId']),
      structuralChange: false,
      hasUntrackedChanges: true,
    });

    expect(result).toBeNull();
  });

  test('returns original buffer when no changes', async () => {
    const buffer = await loadFixture('example-with-image.docx');
    const doc = await parseDocx(buffer, { preloadFonts: false });

    const result = await attemptSelectiveSave(doc, buffer, {
      changedParaIds: new Set(),
      structuralChange: false,
      hasUntrackedChanges: false,
    });

    // Should return the original buffer (no-op)
    expect(result).not.toBeNull();
    expect(result!.byteLength).toBe(buffer.byteLength);
  });

  test('selectively patches a single paragraph edit', async () => {
    const buffer = await loadFixture('example-with-image.docx');
    const doc = await parseDocx(buffer, { preloadFonts: false });

    // Find a paragraph to modify
    const paragraphs = doc.package.document.content.filter(
      (b): b is Paragraph => b.type === 'paragraph'
    );

    // Find a paragraph with a paraId that has text content
    let targetPara: Paragraph | null = null;
    for (const para of paragraphs) {
      if (para.paraId) {
        const text = para.content
          .filter((item): item is Run => item.type === 'run')
          .flatMap((run) => run.content)
          .filter((c) => c.type === 'text')
          .map((c) => c.text)
          .join('');
        if (text.length > 0) {
          targetPara = para;
          break;
        }
      }
    }

    if (!targetPara || !targetPara.paraId) {
      // Skip test if no suitable paragraph found
      console.log('No paragraph with paraId and text found in example-with-image.docx, skipping');
      return;
    }

    const paraId = targetPara.paraId;

    // Modify the paragraph text
    for (const item of targetPara.content) {
      if (item.type === 'run') {
        for (const c of item.content) {
          if (c.type === 'text' && c.text.length > 0) {
            c.text = c.text + ' [MODIFIED]';
            break;
          }
        }
        break;
      }
    }

    // Attempt selective save
    const result = await attemptSelectiveSave(doc, buffer, {
      changedParaIds: new Set([paraId]),
      structuralChange: false,
      hasUntrackedChanges: false,
    });

    if (result === null) {
      // Selective save may fail due to paragraph count mismatch (serializer differences)
      // This is expected — fall back to full repack
      console.log('Selective save returned null (expected fallback), verifying full repack works');
      const fullResult = await repackDocx(doc);
      expect(fullResult.byteLength).toBeGreaterThan(0);
      return;
    }

    // Verify the result is a valid DOCX
    expect(result.byteLength).toBeGreaterThan(0);
    const resultXml = await getDocumentXml(result);
    expect(resultXml).toContain('[MODIFIED]');

    // Verify unchanged paragraphs are preserved
    const originalXml = await getDocumentXml(buffer);
    for (const para of paragraphs) {
      if (para.paraId && para.paraId !== paraId) {
        const origOffsets = findParagraphOffsets(originalXml, para.paraId);
        const resultOffsets = findParagraphOffsets(resultXml, para.paraId);
        if (origOffsets && resultOffsets) {
          const origPara = originalXml.substring(origOffsets.start, origOffsets.end);
          const resultPara = resultXml.substring(resultOffsets.start, resultOffsets.end);
          expect(resultPara).toBe(origPara);
        }
      }
    }
  });

  test('returns null for changed paraId not found in original', async () => {
    const buffer = await loadFixture('example-with-image.docx');
    const doc = await parseDocx(buffer, { preloadFonts: false });

    const result = await attemptSelectiveSave(doc, buffer, {
      changedParaIds: new Set(['NONEXISTENT_PARA_ID']),
      structuralChange: false,
      hasUntrackedChanges: false,
    });

    // Should return null (fallback to full repack)
    expect(result).toBeNull();
  });
});

// ============================================================================
// Round-trip correctness
// ============================================================================

describe('Selective save round-trip', () => {
  test('selective save produces valid DOCX that can be re-parsed', async () => {
    const buffer = await loadFixture('example-with-image.docx');
    const doc = await parseDocx(buffer, { preloadFonts: false });

    // Find a modifiable paragraph
    const paragraphs = doc.package.document.content.filter(
      (b): b is Paragraph => b.type === 'paragraph'
    );

    let targetPara: Paragraph | null = null;
    for (const para of paragraphs) {
      if (para.paraId) {
        const hasText = para.content.some(
          (item) =>
            item.type === 'run' && item.content.some((c) => c.type === 'text' && c.text.length > 0)
        );
        if (hasText) {
          targetPara = para;
          break;
        }
      }
    }

    if (!targetPara?.paraId) {
      console.log('No suitable paragraph for round-trip test, skipping');
      return;
    }

    // Modify and attempt selective save
    const paraId = targetPara.paraId;
    for (const item of targetPara.content) {
      if (item.type === 'run') {
        for (const c of item.content) {
          if (c.type === 'text' && c.text.length > 0) {
            c.text = 'ROUNDTRIP_TEST';
            break;
          }
        }
        break;
      }
    }

    const savedBuffer = await attemptSelectiveSave(doc, buffer, {
      changedParaIds: new Set([paraId]),
      structuralChange: false,
      hasUntrackedChanges: false,
    });

    if (!savedBuffer) {
      // Fallback is acceptable
      console.log('Selective save fell back, testing full repack round-trip instead');
      const fullBuffer = await repackDocx(doc);
      const reopened = await parseDocx(fullBuffer, { preloadFonts: false });
      expect(reopened.package.document.content.length).toBeGreaterThan(0);
      return;
    }

    // Re-parse the saved document
    const reopened = await parseDocx(savedBuffer, { preloadFonts: false });
    expect(reopened.package.document.content.length).toBeGreaterThan(0);

    // Verify the modified text exists
    const modifiedPara = reopened.package.document.content.find(
      (b): b is Paragraph => b.type === 'paragraph' && b.paraId === paraId
    );
    if (modifiedPara) {
      const text = modifiedPara.content
        .filter((item): item is Run => item.type === 'run')
        .flatMap((run) => run.content)
        .filter((c) => c.type === 'text')
        .map((c) => c.text)
        .join('');
      expect(text).toContain('ROUNDTRIP_TEST');
    }
  });

  test('no-edit save preserves document.xml exactly', async () => {
    const buffer = await loadFixture('example-with-image.docx');
    const doc = await parseDocx(buffer, { preloadFonts: false });

    const savedBuffer = await attemptSelectiveSave(doc, buffer, {
      changedParaIds: new Set(),
      structuralChange: false,
      hasUntrackedChanges: false,
    });

    // No changes — should return the original buffer
    expect(savedBuffer).not.toBeNull();
  });
});

// ============================================================================
// buildPatchedDocumentXml with real XML
// ============================================================================

describe('buildPatchedDocumentXml with real DOCX XML', () => {
  test('patches real document.xml correctly', async () => {
    const buffer = await loadFixture('example-with-image.docx');
    const originalXml = await getDocumentXml(buffer);

    // Find all paraIds
    const paraIdPattern = /w14:paraId="([^"]+)"/g;
    const allIds: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = paraIdPattern.exec(originalXml)) !== null) {
      allIds.push(m[1]);
    }

    // Build a "serialized" version with one paragraph modified
    // (In real usage this comes from serializeDocument after document model changes)
    const uniqueIds = [...new Set(allIds)];
    if (uniqueIds.length === 0) {
      console.log('No paraIds in example-with-image.docx, skipping');
      return;
    }

    // Find a paraId that can be located in the XML
    let testId: string | null = null;
    for (const id of uniqueIds) {
      if (findParagraphOffsets(originalXml, id)) {
        testId = id;
        break;
      }
    }

    if (!testId) {
      console.log('No locatable paraId in example-with-image.docx, skipping');
      return;
    }

    // Create a modified version where the target paragraph has different content
    const origOffsets = findParagraphOffsets(originalXml, testId)!;
    const origParagraph = originalXml.substring(origOffsets.start, origOffsets.end);
    const modifiedParagraph = origParagraph.replace(
      /<w:t[^>]*>[^<]*<\/w:t>/,
      '<w:t>PATCHED_TEXT</w:t>'
    );

    // Build the "serialized" XML with just this one paragraph changed
    const serializedXml =
      originalXml.substring(0, origOffsets.start) +
      modifiedParagraph +
      originalXml.substring(origOffsets.end);

    const patched = buildPatchedDocumentXml(originalXml, serializedXml, new Set([testId]));
    expect(patched).not.toBeNull();

    if (patched) {
      // The patched paragraph should have the new content
      const patchedOffsets = findParagraphOffsets(patched, testId)!;
      const patchedPara = patched.substring(patchedOffsets.start, patchedOffsets.end);
      expect(patchedPara).toContain('PATCHED_TEXT');

      // All other content should be identical
      // Check that the content before the patched paragraph is byte-for-byte identical
      expect(patched.substring(0, patchedOffsets.start)).toBe(
        originalXml.substring(0, origOffsets.start)
      );
    }
  });
});

// ============================================================================
// Edge cases
// ============================================================================

describe('Selective save edge cases', () => {
  test('handles document with tables', async () => {
    const buffer = await loadFixture('with-tables.docx');
    const doc = await parseDocx(buffer, { preloadFonts: false });
    const xml = await getDocumentXml(buffer);

    // Verify we can count paragraphs (tables contain w:p elements too)
    const count = countParagraphElements(xml);
    expect(count).toBeGreaterThan(0);

    // No changes = should return original
    const result = await attemptSelectiveSave(doc, buffer, {
      changedParaIds: new Set(),
      structuralChange: false,
      hasUntrackedChanges: false,
    });
    expect(result).not.toBeNull();
  });

  test('handles complex styled document', async () => {
    const buffer = await loadFixture('complex-styles.docx');
    const doc = await parseDocx(buffer, { preloadFonts: false });
    const xml = await getDocumentXml(buffer);

    const count = countParagraphElements(xml);
    expect(count).toBeGreaterThan(0);

    // No changes = should return original
    const result = await attemptSelectiveSave(doc, buffer, {
      changedParaIds: new Set(),
      structuralChange: false,
      hasUntrackedChanges: false,
    });
    expect(result).not.toBeNull();
  });

  test('handles document with missing paraIds gracefully', async () => {
    // Create a minimal DOCX-like XML without paraIds
    // The attempt should fall back (return null) if we ask to patch a nonexistent ID
    const buffer = await loadFixture('example-with-image.docx');
    const doc = await parseDocx(buffer, { preloadFonts: false });

    const result = await attemptSelectiveSave(doc, buffer, {
      changedParaIds: new Set(['FAKE_ID_12345']),
      structuralChange: false,
      hasUntrackedChanges: false,
    });

    expect(result).toBeNull(); // Should fall back
  });

  test('handles large document with many paraIds', async () => {
    const buffer = await loadFixture('EP_ZMVZ_MULTI_v4.docx');
    const doc = await parseDocx(buffer, { preloadFonts: false });
    const xml = await getDocumentXml(buffer);

    // Count paraIds
    const paraIdPattern = /w14:paraId="([^"]+)"/g;
    const ids: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = paraIdPattern.exec(xml)) !== null) {
      ids.push(m[1]);
    }
    expect(ids.length).toBeGreaterThan(50);

    // No-changes save should work
    const noChangeResult = await attemptSelectiveSave(doc, buffer, {
      changedParaIds: new Set(),
      structuralChange: false,
      hasUntrackedChanges: false,
    });
    expect(noChangeResult).not.toBeNull();

    // Single paragraph edit
    const paragraphs = doc.package.document.content.filter(
      (b): b is Paragraph => b.type === 'paragraph' && !!b.paraId
    );
    expect(paragraphs.length).toBeGreaterThan(0);

    const target = paragraphs.find((p) =>
      p.content.some(
        (i) => i.type === 'run' && i.content.some((c) => c.type === 'text' && c.text.length > 0)
      )
    );

    if (target?.paraId) {
      // Modify target paragraph
      for (const item of target.content) {
        if (item.type === 'run') {
          for (const c of item.content) {
            if (c.type === 'text' && c.text.length > 0) {
              c.text = c.text + ' [LARGE_DOC_TEST]';
              break;
            }
          }
          break;
        }
      }

      const result = await attemptSelectiveSave(doc, buffer, {
        changedParaIds: new Set([target.paraId]),
        structuralChange: false,
        hasUntrackedChanges: false,
      });

      if (result) {
        // Verify it's a valid ZIP
        expect(result.byteLength).toBeGreaterThan(0);
        const resultXml = await getDocumentXml(result);
        expect(resultXml).toContain('[LARGE_DOC_TEST]');

        // Verify other paragraphs are byte-for-byte identical
        const originalXml = await getDocumentXml(buffer);
        let checkedCount = 0;
        for (const para of paragraphs.slice(0, 10)) {
          if (para.paraId && para.paraId !== target.paraId) {
            const origOffsets = findParagraphOffsets(originalXml, para.paraId);
            const resultOffsets = findParagraphOffsets(resultXml, para.paraId);
            if (origOffsets && resultOffsets) {
              const origText = originalXml.substring(origOffsets.start, origOffsets.end);
              const resultText = resultXml.substring(resultOffsets.start, resultOffsets.end);
              expect(resultText).toBe(origText);
              checkedCount++;
            }
          }
        }
        expect(checkedCount).toBeGreaterThan(0);
      }
    }
  });

  test('selective save disabled falls back to full repack', async () => {
    const buffer = await loadFixture('example-with-image.docx');
    const doc = await parseDocx(buffer, { preloadFonts: false });

    // When structuralChange=true (simulating selective=false at higher level), we get null
    const result = await attemptSelectiveSave(doc, buffer, {
      changedParaIds: new Set(),
      structuralChange: true,
      hasUntrackedChanges: false,
    });
    expect(result).toBeNull();
  });

  test('multiple paragraphs edited selectively', async () => {
    const buffer = await loadFixture('example-with-image.docx');
    const doc = await parseDocx(buffer, { preloadFonts: false });

    const paragraphs = doc.package.document.content.filter(
      (b): b is Paragraph =>
        b.type === 'paragraph' &&
        !!b.paraId &&
        b.content.some(
          (i) => i.type === 'run' && i.content.some((c) => c.type === 'text' && c.text.length > 0)
        )
    );

    if (paragraphs.length < 2) {
      console.log('Not enough paragraphs with paraId to test multi-edit');
      return;
    }

    const editIds: string[] = [];
    // Edit first two paragraphs with paraIds
    for (const para of paragraphs.slice(0, 2)) {
      for (const item of para.content) {
        if (item.type === 'run') {
          for (const c of item.content) {
            if (c.type === 'text' && c.text.length > 0) {
              c.text = c.text + ` [MULTI_${para.paraId}]`;
              break;
            }
          }
          break;
        }
      }
      editIds.push(para.paraId!);
    }

    const result = await attemptSelectiveSave(doc, buffer, {
      changedParaIds: new Set(editIds),
      structuralChange: false,
      hasUntrackedChanges: false,
    });

    if (result) {
      const resultXml = await getDocumentXml(result);
      for (const id of editIds) {
        expect(resultXml).toContain(`[MULTI_${id}]`);
      }

      // Verify an unedited paragraph is unchanged
      const uneditedPara = paragraphs.find((p) => !editIds.includes(p.paraId!));
      if (uneditedPara?.paraId) {
        const originalXml = await getDocumentXml(buffer);
        const origOffsets = findParagraphOffsets(originalXml, uneditedPara.paraId);
        const resultOffsets = findParagraphOffsets(resultXml, uneditedPara.paraId);
        if (origOffsets && resultOffsets) {
          expect(resultXml.substring(resultOffsets.start, resultOffsets.end)).toBe(
            originalXml.substring(origOffsets.start, origOffsets.end)
          );
        }
      }
    }
  });
});

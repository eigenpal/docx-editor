import { test, expect } from '@playwright/test';
import type { Document, BlockContent } from '../../src/types/document';
import { createEmptyDocx, repackDocx } from '../../src/docx/rezip';
import { withBaselineDocument } from '../../src/docx/revisions/baseline';
import {
  createBaselineSnapshot,
  createBaselineFromBlocks,
  createTextParagraph,
  createTable,
  extractDocumentXml,
} from '../helpers/track-changes-export';

function createDocumentForExport(
  originalBuffer: ArrayBuffer,
  currentParagraphText: string,
  baselineParagraphText: string
): Document {
  return {
    package: {
      document: {
        content: [createTextParagraph(currentParagraphText)],
      },
    },
    originalBuffer,
    baselineDocument: createBaselineSnapshot(originalBuffer, baselineParagraphText),
  };
}

function createDocumentFromBlocks(
  originalBuffer: ArrayBuffer,
  currentBlocks: BlockContent[],
  baselineBlocks: BlockContent[]
): Document {
  return {
    package: {
      document: {
        content: currentBlocks,
      },
    },
    originalBuffer,
    baselineDocument: createBaselineFromBlocks(originalBuffer, baselineBlocks),
  };
}

const trackChangesOptions = {
  trackChanges: {
    enabled: true,
    author: 'Tester',
    date: '2026-02-22T12:00:00Z',
  },
};

test.describe('Track Changes Export XML Assertions', () => {
  test('emits insertion wrappers when tracked export is enabled', async () => {
    const originalBuffer = await createEmptyDocx();
    const doc = createDocumentForExport(originalBuffer, 'Tracked insertion', '');

    const exportedBuffer = await repackDocx(doc, {
      trackChanges: {
        enabled: true,
        author: 'Track Tester',
        date: '2026-02-22T12:00:00Z',
      },
    });

    const documentXml = await extractDocumentXml(exportedBuffer);

    expect(documentXml).toContain('<w:ins ');
    expect(documentXml).toContain('w:author="Track Tester"');
    expect(documentXml).toContain('w:date="2026-02-22T12:00:00.000Z"');
    expect(documentXml).toContain('<w:t>Tracked insertion</w:t>');
    expect(documentXml).not.toContain('<w:del ');
  });

  test('emits deletion wrappers with delText when existing text is removed', async () => {
    const originalBuffer = await createEmptyDocx();
    const doc = createDocumentForExport(originalBuffer, 'aseline text', 'Baseline text');

    const exportedBuffer = await repackDocx(doc, {
      trackChanges: {
        enabled: true,
        author: 'Delete Reviewer',
      },
    });

    const documentXml = await extractDocumentXml(exportedBuffer);

    expect(documentXml).toContain('<w:del ');
    expect(documentXml).toContain('w:author="Delete Reviewer"');
    expect(documentXml).toContain('<w:delText>B</w:delText>');
  });

  test('keeps legacy output when tracked export is disabled', async () => {
    const originalBuffer = await createEmptyDocx();
    const doc = createDocumentForExport(originalBuffer, 'Plain save', '');

    const exportedBuffer = await repackDocx(doc, {
      trackChanges: {
        enabled: false,
        author: 'Ignored Author',
      },
    });

    const documentXml = await extractDocumentXml(exportedBuffer);

    expect(documentXml).not.toContain('<w:ins ');
    expect(documentXml).not.toContain('<w:del ');
    expect(documentXml).toContain('<w:t>Plain save</w:t>');
  });
});

test.describe('Table-level structural track changes', () => {
  test('emits insertion wrappers when a table is inserted', async () => {
    const originalBuffer = await createEmptyDocx();
    const table = createTable([['Cell A', 'Cell B']]);
    const doc = createDocumentFromBlocks(originalBuffer, [table], []);

    const exportedBuffer = await repackDocx(doc, trackChangesOptions);
    const xml = await extractDocumentXml(exportedBuffer);

    expect(xml).toContain('<w:ins ');
    expect(xml).toContain('<w:t>Cell A</w:t>');
    expect(xml).toContain('<w:t>Cell B</w:t>');
    expect(xml).not.toContain('<w:del ');
  });

  test('emits deletion wrappers when a table is deleted', async () => {
    const originalBuffer = await createEmptyDocx();
    const table = createTable([['Removed content']]);
    const doc = createDocumentFromBlocks(originalBuffer, [], [table]);

    const exportedBuffer = await repackDocx(doc, trackChangesOptions);
    const xml = await extractDocumentXml(exportedBuffer);

    expect(xml).toContain('<w:del ');
    expect(xml).toContain('<w:delText>Removed content</w:delText>');
  });

  test('emits insertion wrappers when a new row is added to a table', async () => {
    const originalBuffer = await createEmptyDocx();
    const baselineTable = createTable([['Row 1']]);
    const currentTable = createTable([['Row 1'], ['New Row 2']]);
    const doc = createDocumentFromBlocks(originalBuffer, [currentTable], [baselineTable]);

    const exportedBuffer = await repackDocx(doc, trackChangesOptions);
    const xml = await extractDocumentXml(exportedBuffer);

    expect(xml).toContain('<w:t>Row 1</w:t>');
    expect(xml).toContain('<w:ins ');
    expect(xml).toContain('<w:t>New Row 2</w:t>');
  });

  test('emits deletion wrappers when a cell is removed from a row', async () => {
    const originalBuffer = await createEmptyDocx();
    const baselineTable = createTable([['Keep', 'Remove']]);
    const currentTable = createTable([['Keep']]);
    const doc = createDocumentFromBlocks(originalBuffer, [currentTable], [baselineTable]);

    const exportedBuffer = await repackDocx(doc, trackChangesOptions);
    const xml = await extractDocumentXml(exportedBuffer);

    expect(xml).toContain('<w:t>Keep</w:t>');
    expect(xml).toContain('<w:del ');
    expect(xml).toContain('<w:delText>Remove</w:delText>');
  });

  test('emits insertion wrappers when a cell is added to a row', async () => {
    const originalBuffer = await createEmptyDocx();
    const baselineTable = createTable([['Existing']]);
    const currentTable = createTable([['Existing', 'New cell']]);
    const doc = createDocumentFromBlocks(originalBuffer, [currentTable], [baselineTable]);

    const exportedBuffer = await repackDocx(doc, trackChangesOptions);
    const xml = await extractDocumentXml(exportedBuffer);

    expect(xml).toContain('<w:t>Existing</w:t>');
    expect(xml).toContain('<w:ins ');
    expect(xml).toContain('<w:t>New cell</w:t>');
  });

  test('handles table with multiple rows and cells changed', async () => {
    const originalBuffer = await createEmptyDocx();
    const baselineTable = createTable([
      ['A1', 'B1'],
      ['A2', 'B2'],
    ]);
    const currentTable = createTable([
      ['A1', 'B1 modified'],
      ['A2', 'B2'],
    ]);
    const doc = createDocumentFromBlocks(originalBuffer, [currentTable], [baselineTable]);

    const exportedBuffer = await repackDocx(doc, trackChangesOptions);
    const xml = await extractDocumentXml(exportedBuffer);

    expect(xml).toContain('<w:ins ');
    expect(xml).toContain('<w:t>B1</w:t>');
    expect(xml).toContain(' modified</w:t>');
  });
});

test.describe('Edge cases', () => {
  test('handles empty document diff without errors', async () => {
    const originalBuffer = await createEmptyDocx();
    const doc = createDocumentFromBlocks(originalBuffer, [], []);

    const exportedBuffer = await repackDocx(doc, trackChangesOptions);
    const xml = await extractDocumentXml(exportedBuffer);

    expect(xml).not.toContain('<w:ins ');
    expect(xml).not.toContain('<w:del ');
  });

  test('handles formatting-only changes (text identical)', async () => {
    const originalBuffer = await createEmptyDocx();
    const baseline = createTextParagraph('Same text');
    const current: BlockContent = {
      type: 'paragraph',
      content: [
        {
          type: 'run',
          content: [{ type: 'text', text: 'Same text' }],
          formatting: { bold: true },
        },
      ],
    };
    const doc = createDocumentFromBlocks(originalBuffer, [current], [baseline]);

    const exportedBuffer = await repackDocx(doc, trackChangesOptions);
    const xml = await extractDocumentXml(exportedBuffer);

    expect(xml).toContain('<w:t>Same text</w:t>');
  });

  test('handles document with only tables (no paragraphs)', async () => {
    const originalBuffer = await createEmptyDocx();
    const table = createTable([['Only table']]);
    const doc = createDocumentFromBlocks(originalBuffer, [table], [table]);

    const exportedBuffer = await repackDocx(doc, trackChangesOptions);
    const xml = await extractDocumentXml(exportedBuffer);

    expect(xml).toContain('<w:t>Only table</w:t>');
    expect(xml).not.toContain('<w:ins ');
    expect(xml).not.toContain('<w:del ');
  });

  test('graceful fallback when baselineDocument is missing', async () => {
    const originalBuffer = await createEmptyDocx();
    const doc: Document = {
      package: {
        document: {
          content: [createTextParagraph('No baseline')],
        },
      },
      originalBuffer,
    };

    const exportedBuffer = await repackDocx(doc, trackChangesOptions);
    const xml = await extractDocumentXml(exportedBuffer);

    expect(xml).toContain('<w:t>No baseline</w:t>');
  });
});

test.describe('Move semantics in exported XML', () => {
  test('emits moveFrom/moveTo wrappers with range markers when paragraph is moved', async () => {
    const originalBuffer = await createEmptyDocx();
    const baseline = [createTextParagraph('First'), createTextParagraph('Second')];
    const current = [createTextParagraph('Second'), createTextParagraph('First')];
    const doc = createDocumentFromBlocks(originalBuffer, current, baseline);

    const exportedBuffer = await repackDocx(doc, trackChangesOptions);
    const xml = await extractDocumentXml(exportedBuffer);

    expect(xml).toContain('<w:moveFrom ');
    expect(xml).toContain('<w:moveTo ');
    expect(xml).toContain('<w:moveFromRangeStart ');
    expect(xml).toContain('<w:moveFromRangeEnd ');
    expect(xml).toContain('<w:moveToRangeStart ');
    expect(xml).toContain('<w:moveToRangeEnd ');
  });

  test('move range start/end IDs match', async () => {
    const originalBuffer = await createEmptyDocx();
    const baseline = [createTextParagraph('Alpha'), createTextParagraph('Beta')];
    const current = [createTextParagraph('Beta'), createTextParagraph('Alpha')];
    const doc = createDocumentFromBlocks(originalBuffer, current, baseline);

    const exportedBuffer = await repackDocx(doc, trackChangesOptions);
    const xml = await extractDocumentXml(exportedBuffer);

    const fromStartMatch = xml.match(/<w:moveFromRangeStart\s+w:id="(\d+)"/);
    const fromEndMatch = xml.match(/<w:moveFromRangeEnd\s+w:id="(\d+)"/);
    const toStartMatch = xml.match(/<w:moveToRangeStart\s+w:id="(\d+)"/);
    const toEndMatch = xml.match(/<w:moveToRangeEnd\s+w:id="(\d+)"/);

    expect(fromStartMatch).not.toBeNull();
    expect(fromEndMatch).not.toBeNull();
    expect(toStartMatch).not.toBeNull();
    expect(toEndMatch).not.toBeNull();

    expect(fromStartMatch![1]).toBe(fromEndMatch![1]);
    expect(toStartMatch![1]).toBe(toEndMatch![1]);
    expect(fromStartMatch![1]).toBe(toStartMatch![1]);
  });

  test('non-moved changes use ins/del not moveFrom/moveTo', async () => {
    const originalBuffer = await createEmptyDocx();
    const baseline = [createTextParagraph('Keep'), createTextParagraph('Old unique')];
    const current = [createTextParagraph('Keep'), createTextParagraph('New unique')];
    const doc = createDocumentFromBlocks(originalBuffer, current, baseline);

    const exportedBuffer = await repackDocx(doc, trackChangesOptions);
    const xml = await extractDocumentXml(exportedBuffer);

    expect(xml).not.toContain('<w:moveFrom ');
    expect(xml).not.toContain('<w:moveTo ');
    expect(xml).toContain('<w:ins ');
    expect(xml).toContain('<w:del ');
  });
});

test.describe('DocumentAgent tracked export', () => {
  test('withBaseline() + toBuffer() emits tracked changes for modified content', async () => {
    const buffer = await createEmptyDocx();
    const { DocumentAgent } = await import('../../src/agent/DocumentAgent');

    const initialDoc: Document = {
      package: { document: { content: [createTextParagraph('Original text')] } },
      originalBuffer: buffer,
    };
    const agent = DocumentAgent.fromDocument(initialDoc);
    const withBaseline = agent.withBaseline();

    const editedDoc: Document = {
      ...withBaseline.getDocument(),
      package: { document: { content: [createTextParagraph('Modified text')] } },
    };
    const editedAgent = DocumentAgent.fromDocument(editedDoc);

    const out = await editedAgent.toBuffer({
      trackChanges: { enabled: true, author: 'Agent Test' },
    });
    const xml = await extractDocumentXml(out);

    expect(xml).toContain('<w:ins ');
    expect(xml).toContain('<w:del ');
    expect(xml).toContain('w:author="Agent Test"');
  });

  test('toBuffer() without withBaseline() emits no tracked changes', async () => {
    const buffer = await createEmptyDocx();
    const { DocumentAgent } = await import('../../src/agent/DocumentAgent');

    const agent = DocumentAgent.fromDocument({
      package: { document: { content: [createTextParagraph('Untracked')] } },
      originalBuffer: buffer,
    });

    const out = await agent.toBuffer({
      trackChanges: { enabled: true, author: 'Should Be Ignored' },
    });
    const xml = await extractDocumentXml(out);

    expect(xml).not.toContain('<w:ins ');
    expect(xml).not.toContain('<w:del ');
    expect(xml).toContain('<w:t>Untracked</w:t>');
  });
});

test.describe('Editor baseline lifecycle transitions', () => {
  // These tests simulate the controlled DocxEditor flow at the pipeline level:
  //   initialDocument load → user edits → onChange strips baseline → parent echoes back → DocxEditor update
  // They validate that withBaselineDocument + repackDocx behave correctly across this cycle.

  test('controlled echo: baseline is preserved when same-buffer document is re-loaded', async () => {
    // Simulates: DocxEditor loads doc → onChange strips baseline → parent echoes stripped doc back.
    // withBaselineDocument(strippedDoc, previousBaseline) must reuse the ORIGINAL baseline so that
    // the diff still compares edited content against the original, not against itself.
    const originalBuffer = await createEmptyDocx();
    const originalContent = [createTextParagraph('Original text')];
    const editedContent = [createTextParagraph('Edited text')];

    // Step 1: Load with track changes → withBaselineDocument creates baseline from original content.
    const loadedDoc: Document = {
      package: { document: { content: originalContent } },
      originalBuffer,
    };
    const docWithBaseline = withBaselineDocument(loadedDoc);
    const capturedBaseline = docWithBaseline.baselineDocument!;

    // Step 2: User edits → history holds doc with editedContent but same baseline.
    const editedDoc: Document = {
      ...docWithBaseline,
      package: { document: { content: editedContent } },
    };

    // Step 3: onChange strips baseline before calling consumer (DocxEditor line 653).
    const { baselineDocument: _stripped, ...strippedDoc } = editedDoc;

    // Step 4: Consumer echoes back → same originalBuffer → DocxEditor preserves baseline from ref.
    // isNewDocument = (capturedBaseline.originalBuffer !== strippedDoc.originalBuffer) = false
    const isNewDocument = strippedDoc.originalBuffer !== capturedBaseline.originalBuffer;
    const fallback = isNewDocument ? undefined : capturedBaseline;
    const updatedDoc = withBaselineDocument(strippedDoc, fallback);

    // Step 5: Export → diff must be original→edited, not edited→edited.
    const xml = await repackDocx(updatedDoc, trackChangesOptions).then(extractDocumentXml);

    expect(xml).toContain('<w:ins ');
    expect(xml).toContain('<w:del ');
    expect(xml).toContain('w:author="Tester"');
  });

  test('new document: baseline resets when originalBuffer changes (no cross-doc leakage)', async () => {
    // Simulates switching from doc A to doc B. The new buffer triggers a fresh baseline
    // so doc B is diffed against its own content (no cross-doc spurious changes).
    const bufferA = await createEmptyDocx();
    const bufferB = await createEmptyDocx();

    // Baseline captured while editing doc A
    const baselineFromDocA = withBaselineDocument({
      package: { document: { content: [createTextParagraph('Doc A text')] } },
      originalBuffer: bufferA,
    }).baselineDocument!;

    // Doc B arrives with a different originalBuffer → isNewDocument = true → no fallback
    const docB: Document = {
      package: { document: { content: [createTextParagraph('Doc B text')] } },
      originalBuffer: bufferB,
    };
    const isNewDocument = baselineFromDocA.originalBuffer !== docB.originalBuffer;
    const fallback = isNewDocument ? undefined : baselineFromDocA;
    const docBWithBaseline = withBaselineDocument(docB, fallback);

    const xml = await repackDocx(docBWithBaseline, trackChangesOptions).then(extractDocumentXml);

    // Doc B content is identical to its own fresh baseline → no tracked changes
    expect(xml).toContain('<w:t>Doc B text</w:t>');
    expect(xml).not.toContain('<w:ins ');
    expect(xml).not.toContain('<w:del ');
  });

  test('disable → re-enable cycle: re-export with fresh baseline shows no changes', async () => {
    // After disable, baseline is cleared. On re-enable, a fresh baseline is snapped from current
    // state. Exporting without further edits must produce no tracked changes.
    const originalBuffer = await createEmptyDocx();
    const currentContent = [createTextParagraph('State at re-enable time')];

    // Re-enable: withBaselineDocument(currentDoc) with no fallback → baseline = current content
    const reEnabledDoc = withBaselineDocument({
      package: { document: { content: currentContent } },
      originalBuffer,
    });

    const xml = await repackDocx(reEnabledDoc, trackChangesOptions).then(extractDocumentXml);

    expect(xml).toContain('<w:t>State at re-enable time</w:t>');
    expect(xml).not.toContain('<w:ins ');
    expect(xml).not.toContain('<w:del ');
  });

  test('edits after re-enable are tracked against re-enable baseline, not pre-disable state', async () => {
    // Baseline at re-enable time is "State A". User then edits to "State B".
    // Tracked changes must reflect A→B, not any earlier pre-disable history.
    const originalBuffer = await createEmptyDocx();

    const docAfterEdit: Document = {
      package: { document: { content: [createTextParagraph('State B')] } },
      originalBuffer,
      baselineDocument: {
        package: { document: { content: [createTextParagraph('State A')] } },
        originalBuffer,
      },
    };

    const xml = await repackDocx(docAfterEdit, trackChangesOptions).then(extractDocumentXml);

    expect(xml).toContain('<w:ins ');
    expect(xml).toContain('<w:del ');
    expect(xml).toContain('w:author="Tester"');
  });
});

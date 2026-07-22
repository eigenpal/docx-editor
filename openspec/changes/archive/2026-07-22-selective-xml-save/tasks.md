## 1. Paragraph Change Tracking Plugin

- [x] 1.1 Create `ParagraphChangeTrackerExtension` in `src/prosemirror/extensions/features/` — a ProseMirror plugin that watches transactions for paragraph modifications and records changed `paraId` values in a `Set<string>`. Track structural changes (paragraph added/deleted) separately as a boolean flag.
- [x] 1.2 Expose `getChangedParagraphIds()`, `hasStructuralChanges()`, and `clearTrackedChanges()` methods on the extension, accessible via the singleton extension manager.
- [x] 1.3 Register the extension in `StarterKit.ts` so it's included in every editor instance.
- [x] 1.4 Write unit tests for the change tracker: single paragraph edit, multi-paragraph formatting, paragraph split (Enter), paragraph merge (Backspace), no-edit scenario, paragraphs without paraId, and clear-after-save.

## 2. Selective XML Patch Module

- [x] 2.1 Create `src/docx/selectiveXmlPatch.ts` with `findParagraphOffsets(originalXml: string, paraId: string): { start: number; end: number } | null` — finds the exact string offsets of a `<w:p>` element by `w14:paraId`, handling nested elements correctly (proper tag depth counting, not lazy regex).
- [x] 2.2 Add `extractParagraphXml(serializedXml: string, paraId: string): string | null` — extracts the serialized `<w:p>` element for a given paraId from the full serialized document.xml.
- [x] 2.3 Add `validatePatchSafety(originalXml: string, serializedXml: string, changedIds: Set<string>): { safe: boolean; reason?: string }` — checks that all changed paraIds exist in both original and serialized XML, no duplicates, and paragraph counts match.
- [x] 2.4 Add `buildPatchedDocumentXml(originalXml: string, serializedXml: string, changedIds: Set<string>): string | null` — the main function that orchestrates finding offsets, extracting new XML, and splicing replacements (applied end-to-start to preserve offsets). Returns null if any step fails.
- [x] 2.5 Write unit tests for `findParagraphOffsets`: simple paragraph, nested `mc:AlternateContent` with inner `<w:p>`, duplicate paraId, missing paraId, self-closing tags, paragraphs with many attributes.
- [x] 2.6 Write unit tests for `buildPatchedDocumentXml`: single replacement, multiple replacements, replacement with longer/shorter XML, all edge cases from the safety validation.

## 3. Selective Save Integration

- [x] 3.1 Add `attemptSelectiveSave(doc: Document, originalBuffer: ArrayBuffer, changedIds: Set<string>): Promise<ArrayBuffer | null>` in `src/docx/rezip.ts` (or a new `src/docx/selectiveSave.ts`) — orchestrates: serialize full document.xml → validate patch → build patched XML → call `updateMultipleFiles()` with patched document.xml (plus any re-serialized headers/footers). Returns null on any failure (triggering fallback).
- [x] 3.2 Wire into `DocxEditor.handleSave()`: before calling `repackDocx()`, check if selective save is possible (original buffer exists, no structural changes, change tracker has IDs). If yes, attempt selective save. If it returns null, fall back to `repackDocx()`. Clear change tracker on success.
- [x] 3.3 Add `selective?: boolean` option to the save API (default `true`). When `false`, skip selective save and go straight to full repack.
- [x] 3.4 Export `updateMultipleFiles` from `rezip.ts` publicly if not already exported (needed for the selective save module).

## 4. Tests

- [x] 4.1 Unit tests for `findParagraphOffsets` with real DOCX XML: simple paragraph, nested `mc:AlternateContent` with inner `<w:p>`, duplicate paraId, missing paraId, self-closing tags, paragraphs with many attributes. (28 tests in selectiveXmlPatch.test.ts)
- [x] 4.2 Unit tests for `buildPatchedDocumentXml`: single/multiple replacements, longer/shorter XML, safety validation edge cases. (included in selectiveXmlPatch.test.ts)
- [x] 4.3 Unit tests for ParagraphChangeTracker: single edit, multi-paragraph, paragraph split/merge, no-edit, untracked paragraphs, clear-after-save. (12 tests in ParagraphChangeTrackerExtension.test.ts)
- [x] 4.4 Integration tests: selective save with single paragraph edit, round-trip correctness, no-edit save, fallback on structural change, fallback on untracked changes, fallback on missing paraId. (16 tests in selectiveSave.test.ts)
- [x] 4.5 Integration tests with real fixtures: example-with-image.docx (21 paraIds), EP_ZMVZ_MULTI_v4.docx (103 paraIds, large doc), with-tables.docx, complex-styles.docx.
- [x] 4.6 Tests for: multiple paragraphs edited selectively, selective save disabled (fallback), byte-for-byte preservation of unchanged paragraphs.

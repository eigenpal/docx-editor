## Why

When the editor saves a DOCX, it fully re-serializes and repacks every XML part from the Document model. Even a single character edit produces a document.xml that differs across hundreds of lines from the original — reformatted whitespace, reordered attributes, and regenerated paragraphs the user never touched. When customers open the saved file in Microsoft Word and use Review → Compare, they see massive spurious diffs instead of just their intended changes. This erodes trust for enterprise workflows where document integrity is critical.

The existing `rezip.ts` already has `updateMultipleFiles()` for targeted ZIP patching, and every paragraph carries a `paraId` through the ProseMirror layer. The infrastructure is ready — we just need to connect the dots.

## What Changes

- **Track which paragraphs changed** during editing via a ProseMirror plugin that watches transactions and records mutated `paraId` values.
- **Build a selective XML patch plan** that, given the set of changed paragraph IDs, extracts only those paragraphs' new XML from the serializer and splices them into the original `document.xml` string (preserving unchanged XML byte-for-byte).
- **Apply the patch via `updateMultipleFiles()`** in `rezip.ts` to produce the final DOCX, falling back to full repack when the patch cannot be safely applied (e.g., structural changes like section properties, headers/footers, new images/hyperlinks, or new/deleted paragraphs).
- **Expose a `selectiveSave` option** on `DocxEditorRef.save()` (default: `true`) so callers can opt out if needed.
- **No new components** — this is an enhancement to the existing `DocxEditor` save path, not a separate editor component.

## Capabilities

### New Capabilities

- `paragraph-change-tracking`: ProseMirror plugin that tracks which paragraph IDs were modified during editing
- `selective-xml-patch`: Build and apply targeted XML patches to document.xml using only changed paragraphs
- `selective-save`: Integration of change tracking + XML patching into the DocxEditor save flow with automatic fallback

### Modified Capabilities

## Impact

- **`src/docx/rezip.ts`** — Existing `updateMultipleFiles()` used as-is; may need to export it publicly
- **`src/prosemirror/`** — New plugin for paragraph change tracking
- **`src/docx/serializer/`** — May need a function to serialize individual paragraphs (or extract from full serialization)
- **`src/components/DocxEditor.tsx`** — Save handler gains selective-save branch
- **`src/docx/`** — New module for XML patch building (find paragraph in original XML, replace with new serialized XML)
- **Public API** — `save()` options extended; no breaking changes

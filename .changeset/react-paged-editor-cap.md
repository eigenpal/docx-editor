---
'@eigenpal/docx-editor-react': patch
---

Internal refactor: split PagedEditor.tsx (3230 → 775 LOC) into focused hooks under `components/DocxEditor/hooks/` — useLayoutPipeline, useSelectionOverlay, useImageInteractions, usePagedScrollApi, usePagesPointer, usePagedEditorRefApi, useLayoutTriggers — plus pure helpers domSelection.ts + tableResize.ts. No public API change.

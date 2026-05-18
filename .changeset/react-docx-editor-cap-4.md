---
'@eigenpal/docx-editor-react': patch
---

Internal refactor: continue the DocxEditor.tsx cap effort by splitting the JSX render tree. Two new child components: DocxEditorToolbar (wraps the EditorToolbar with its 30+ props plus the title-bar slots and trailing extras) and DocxEditorPagedArea (PagedEditor mount, sidebar overlay, floating add-comment button, inline header/footer editor). DocxEditor.tsx 1972 → 1815 LOC. No public API change.

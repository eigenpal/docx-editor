---
'@docx-editor.dev/react': major
'@docx-editor.dev/core': major
---

Remove `EditorHost`, `EditorConfig` and `createEditor` from the public surface. They described a retired pipeline in which the adapter supplied DOM handles and a display sink; the editor has painted its own surface since `createDocxEditor` replaced it, and none of the three had a caller. Use `createDocxEditor` with `DocxEditorConfig`.

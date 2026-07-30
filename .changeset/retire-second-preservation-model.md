---
'@docx-editor.dev/react': major
---

One document pipeline. Tables now lay out, paint and edit natively (row pagination with repeated header rows, merged cells, nested tables, editable cell text), and headers/footers render read-only with first/even-page variants. Documents with tables or content controls open editable instead of read-only. The legacy byte-preservation engine is removed with its surface: `DocxEditorRef` shrinks to `load`, `save`, `getDocumentHandle`, `getEditor`, `focus`, `exec` and `snapshot`; comments, find/replace, TOC refresh, tracked changes, image tools and the built-in chrome beyond the title bar are no longer available and will return on the new engine. Saved files re-emit normalized XML with structural fidelity guarantees rather than byte-identical text.

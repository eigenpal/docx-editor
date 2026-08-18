---
'@docx-editor.dev/core': minor
---

The `mode` option accepts `'suggesting'` and now decides the mode a document opens in; the React and Vue `<DocxEditor>` components default it to `'edit'`, so a document carrying `w:trackRevisions` opens ready to type there. Omit `mode` on `createDocxEditor` or `DocxEditor.Root` to keep following the document's request.

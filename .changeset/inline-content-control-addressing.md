---
'@eigenpal/docx-editor-core': minor
---

Content-control addressing now covers inline (`w:sdt`-in-paragraph) controls, including inside table cells: `findContentControls`, `findContentControl`, `setContentControlContent`, `setContentControlValue`, and `removeContentControl` discover and edit them, and `{ includeHeadersFooters: true }` also reaches headers and footers. Results carry `kind` and `location`. The live-editor `DocxEditorRef` methods (React and Vue) gain the same inline support.

Because of this, `findContentControls` now returns inline controls in the body that earlier versions skipped — code relying on the old block-only results (counts, first match) should re-check.

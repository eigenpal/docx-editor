---
'@docx-editor.dev/core': minor
---

Fixed paragraph formatting controls reading a paragraph's document defaults instead of its own formatting, which left "Add space before/after paragraph" with no effect on the page. `PaginatedDocxEditorHandle.setParagraphProperty` takes an `options.mergeAttributes` flag so a line-spacing pick keeps the paragraph's spacing. Fixes #360

---
'@docx-editor.dev/core': minor
---

Added the Paragraph dialog: a `Line spacing options…` row on the line-spacing menu opens `DocxEditor.ParagraphDialog` (`DocxEditorParagraphDialog` in Vue), where alignment, indentation, spacing, line spacing and the paragraph flags are set by value. A new `setParagraphFormat` command and `useParagraphFormat` hook write the whole form as one undo step.

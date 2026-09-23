---
'@docx-editor.dev/core': minor
---

Numbered paragraphs now start their first line at a tab stop between the number and the text indent, so the line wraps with the width it has. Documents that set `w:doNotUseIndentAsNumberingTabStop` use the first tab stop past the number instead of the text indent.

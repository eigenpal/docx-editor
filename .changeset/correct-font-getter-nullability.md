---
'@docx-editor.dev/editor-api': patch
---

Correct font getter types to include `null` when a range has mixed or inherited formatting. Strict TypeScript consumers must now handle the existing nullable runtime result.

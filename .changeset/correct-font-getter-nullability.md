---
'@docx-editor.dev/editor-api': minor
---

Correct font getter types to include `null` when a range has mixed or inherited formatting. Strict TypeScript consumers must now handle the existing nullable runtime result.

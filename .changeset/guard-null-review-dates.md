---
'@docx-editor.dev/editor-api': minor
---

Correct comment, reply, and revision date getter types to include `null` for missing or invalid OOXML dates. Strict TypeScript consumers must now guard these review dates before using `Date` methods.

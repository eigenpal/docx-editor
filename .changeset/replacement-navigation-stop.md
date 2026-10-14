---
'@docx-editor.dev/core': minor
---

A tracked replacement is now one change: Next Change and Previous Change stop on it once and highlight both halves, the review pane keeps the open card beside its text, and `getReviewItems()` and `useReview()` list it as one `'replace'` item by default. To list its deletion and insertion as separate items, pass `pairReplacements: false`.

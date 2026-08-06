---
'@docx-editor.dev/pro': patch
'@docx-editor.dev/react': patch
---

Chrome that describes the document no longer renders before one is loaded. The review rail kept its empty state and host furniture off screen until bytes arrive instead of floating them over the loading screen, `useReview().ready` reports false until a document is present, and the ruler parts render nothing rather than default Letter-size ticks for a page that does not exist yet.

---
'@docx-editor.dev/pro': patch
'@docx-editor.dev/react': patch
---

Chrome that describes the document no longer renders before one is present. The review rail keeps its empty state and host furniture off screen until a document opens instead of floating them over the loading screen, the ruler parts render nothing rather than default Letter-size ticks for a page that does not exist, and the navigation pane and document outline no longer report "no headings" about an absent document. The same applies after a parse failure or a detach, not only while loading. `useReview().ready` reports false until a document is present and the hook now re-derives when a load fails.

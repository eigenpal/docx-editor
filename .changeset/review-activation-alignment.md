---
'@docx-editor.dev/core': patch
---

`setActiveReviewItem` and `useReview().setActive` take a `reveal` option, so a host can choose where an activated change lands instead of taking the engine's default: `'start'`, `'center'`, `'centerIfNeeded'`, `'nearest'`, or `false` to select the item without moving the viewport at all.

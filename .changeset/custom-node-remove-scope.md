---
'@docx-editor.dev/pro': minor
---

Custom-node writes now target the story the reader is in, so a chip inside a header can be removed and updated rather than reporting that no node has that id, and all of them refuse a document open for viewing instead of editing it. The context menu reports a refused Remove through the new `onRemoveRefused` prop instead of closing with the node still there. `useStackedReviewPositions` now places an entry whose anchor has not resolved yet, matching the packaged rail. Previously such an entry was dropped and took no room; cards after it now shift down by whatever the entry reserves (its measured height, or `defaultHeight`, plus the gap).

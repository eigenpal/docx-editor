---
'@docx-editor.dev/pro': minor
---

Removing a custom node from the context menu now targets the story the reader is in, so a chip inside a header is actually removed, and reports a refusal through the new `onRemoveRefused` prop instead of closing the menu with the chip still there. `useStackedReviewPositions` also keeps entries whose anchor has not resolved yet, matching the packaged rail.

---
'@docx-editor.dev/pro': minor
---

The React review rail no longer crashes with "Maximum update depth exceeded" when a comment card becomes active while a card resize is pending. Adds `useReviewCardHeights()`, which measures custom review cards for `useStackedReviewPositions` in React and Vue. Fixes #1981

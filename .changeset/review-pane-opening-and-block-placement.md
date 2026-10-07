---
'@docx-editor.dev/pro': minor
---

Add a `paneOpening` option to `reviewModule` so a host can keep the review pane closed until it opens it, an optional placement to `scrollToBlock`, `getReviewItemsAt` and `getReviewItemRects` to find the review item under a pointer and the rectangles it paints, and a `pairReplacements` review query option that lists a deletion and the insertion that replaces it as one item. Escape now closes toolbar popups that were opened by a click, a reply in a review card shows its own author's color, inputs you add to a review card keep focus, and `useReviewAuthor` also works outside the review rail.

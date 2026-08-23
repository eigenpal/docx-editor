---
'@docx-editor.dev/core': minor
---

`PaginatedSurface` gains `sectionAnchorParagraphAt` and `sectionAtPage`, `TreeDocxSessionView` gains `storyParts`, and `PlacedCell` gains `offsetX` and `offsetY`. All three are produced by the engine and consumed by hosts, so this is additive for callers.

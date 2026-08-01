---
'@docx-editor.dev/core': patch
---

Paragraph borders draw on every edge. `w:pBdr` previously resolved only its bottom rule, so a boxed callout authored with top, left, bottom and right came out as a single underline. All four edges now render, along with `w:bar` and `w:between`, in table cells as well as the body. Consecutive body paragraphs with identical borders are treated as one bordered block the way Word does: the frame opens above the first, closes below the last, and interior boundaries take the `w:between` rule. Side rules sit outside the text column and do not reflow it, matching Word, and a top rule counts as flow height so a boxed paragraph breaks pages where Word breaks it.

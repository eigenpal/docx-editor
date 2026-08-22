---
'@docx-editor.dev/core': minor
---

`selectionRects` and `spansInSelection` take the story's paragraph order as an optional third argument. Omitted, they now read every story the layout paints instead of the body alone, so a selection in a header, footer or note returns its spans rather than nothing.

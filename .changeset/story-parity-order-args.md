---
'@docx-editor.dev/core': major
---

`selectionRects` and `spansInSelection` now require the story's paragraph order as a third argument. Passing only a layout and a selection no longer compiles, because a body-shaped default silently returned the wrong result for a caret in a header, footer or note.

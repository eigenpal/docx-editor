---
'@docx-editor.dev/core': minor
---

`selectionRects` and `spansInSelection` now require the story's paragraph order as a third argument, so a two-argument call no longer compiles. Pass the new `everyStoryOrder(layout)` when you have no story in hand: the body-only order they used to assume is what made a selection in a header, footer or note read as empty.

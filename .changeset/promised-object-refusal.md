---
'@docx-editor.dev/editor-api': patch
---

`InvalidObjectPath` now says which of the two states it means: an object an item accessor answered becomes usable after the next `await context.sync()`, while a released object needs `context.trackedObjects.add(...)`. The message previously described only the released case.

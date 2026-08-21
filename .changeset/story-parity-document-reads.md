---
'@docx-editor.dev/core': patch
---

`bodyText()` returns the whole body story. It used to drop every table cell and every paragraph inside a content control, so a table-heavy document read as nearly empty. `hasReviewContent()` also counts tracked changes and comments that live in a header, footer or note, and no longer caches a stale answer after one is accepted there.

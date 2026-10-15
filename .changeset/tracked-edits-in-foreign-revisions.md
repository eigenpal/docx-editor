---
'@docx-editor.dev/editor-api': minor
---

With `TrackMineOnly`, `Range.insertText()` and `Range.delete()` can edit another author's pending inserted or deleted text, each author's change stays a separate decision that `Revision.accept()` and `Revision.reject()` resolve on its own, and refused edits name their rule in `debugInfo.innerError`. Tracked typing inside another author's insertion now splits their insertion instead of nesting inside it.

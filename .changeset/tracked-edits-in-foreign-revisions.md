---
'@docx-editor.dev/editor-api': minor
---

With `TrackMineOnly`, `Range.insertText()` and `Range.delete()` can edit another author's pending inserted or deleted text, each author's change stays a separate decision, and refused edits name their rule in `debugInfo.innerError`; in a collaboration session, the API refuses strikes over another author's pending insertion or deletion, and edits that start inside or right after one. Tracked typing inside another author's insertion now splits their insertion instead of nesting inside it, and refuses inside a link or content control within it.

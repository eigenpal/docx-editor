---
'@docx-editor.dev/core': patch
---

Accepting, rejecting or reassigning a tracked change on a paragraph mark now reaches the page instead of leaving the old attribution drawn, and every field a fragment publishes takes part in incremental layout reuse. A mark inside a table cell is unchanged, because layout does not publish its revision yet.

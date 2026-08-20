---
'@docx-editor.dev/core': patch
---

Fixes a group of caret and scope defects: undo after editing a header no longer leaves the editor unable to type, opening a header while a footnote is open no longer refuses every keystroke, inserting a footnote over a selection replaces it instead of destroying the note on the next keystroke, redo puts the caret where the redone edit ends, resolving a tracked change keeps the caret on the text it was in, accepting the deletion of a table's only row removes the table, a selection ending at a field no longer collapses, Backspace after a table is a quiet no-op instead of a dropped keystroke, and the paragraph, delete-row and delete-column commands act on every cell of a selected rectangle.

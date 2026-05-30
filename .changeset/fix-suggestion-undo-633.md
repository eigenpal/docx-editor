---
'@eigenpal/docx-editor-core': minor
---

Fix undo in suggesting mode marking an existing character as inserted. Undoing a tracked paragraph break (Enter) now only removes the break, without stamping a stray insertion on the boundary character. Raises the prosemirror-history peer dependency to >= 1.5.0. Fixes #633

---
'@docx-editor.dev/core': major
---

`Revision` and `DocComment` now describe what the engine reads. Dates are optional, because a file may not carry one. `Revision.part` is required and names the part the revision lives in, so a revision in a header or in the styles can be told apart from one in the body. `Revision.type` covers moves, paragraph marks, replacements and structural changes, not just insert, delete and format. `DocComment` carries where it is anchored, and says so when a file left it with no usable range.

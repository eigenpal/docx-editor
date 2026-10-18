---
'@docx-editor.dev/pro': minor
---

In collaboration, accepting or rejecting a tracked change applies to all of that change while another participant types or deletes inside or right after it, and the editing API no longer refuses those edits with `edit.tracked-foreign-revision-unsupported`. Breaking collaboration upgrade: this ships with collaboration format 1.5.2.1; see [Upgrade rooms to format 1.5.2.1](https://www.docx-editor.dev/docs/2.x/pro/collaboration-versions#upgrade-rooms-to-format-1521). Fixes #1363

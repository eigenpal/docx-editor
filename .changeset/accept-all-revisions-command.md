---
'@docx-editor.dev/core': patch
---

The `acceptAllRevisions`, `rejectAllRevisions`, `acceptRevision`, `rejectRevision`, `addComment`, `replyComment`, and `resolveComment` editor commands now run instead of being refused, and they require the review module. Tracked-changes protection now refuses every accept and reject of a tracked change, in the editor and in the editing API, while it keeps comments available.

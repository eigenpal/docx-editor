---
'@docx-editor.dev/pro': minor
---

Add `DocxEditorCollaboration.Status`, which tells users when the document is connecting, offline, waiting for changes, out of sync, or refused an edit. The collaboration hooks also report `waiting`, `recovering`, and `failureCount`, and the Hocuspocus and WebRTC hooks report `unsyncedChanges` so you can warn before a page with unsent edits closes.

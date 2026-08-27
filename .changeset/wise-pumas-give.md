---
'@docx-editor.dev/core': minor
---

Collaboration hosts can now see and recover from every failure: the room hooks report a session that fails after connecting, `authentication-failed` and `transport-disconnected` are distinct failure codes, `useCollaborationStatus` derives `live`, `diverged` and `attached`, and presence chrome finds its session through the editor instead of a prop. `DocxEditorCollaborationRoot` mounts a room without writing the three props that fail quietly, `readCollaborationDocument` reads a room's document on a server without joining it, and an avatar declared with `DocxEditor.AuthorStyle` now reaches remote carets and the avatar stack as well as review cards. `connect` and `rejoin` resolve with the failure instead of rejecting, and the replication seam moved to `@docx-editor.dev/core/collaboration/replication` so the consumer entry offers only what a host consumes.

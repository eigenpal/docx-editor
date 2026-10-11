---
'@docx-editor.dev/pro': minor
'@docx-editor.dev/core': minor
---

Add `compactCollaborationState` and `checkCollaborationRoomGeneration`, so a Hocuspocus server keeps each room's size bounded by compacting it into a new generation when it loads the room. A replica that still holds the previous generation reports `room-generation-changed` and rejoins.

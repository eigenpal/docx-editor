---
'@docx-editor.dev/core': minor
---

Saved documents give every revision its own id across the body, headers, footers, and notes, and replace ids outside the 32-bit range; `readCollaborationDocument` accepts `{ keepRevisionIds: true }` for room migration exports. Fixes #1429.

---
'@docx-editor.dev/core': patch
---

Keep a queued collaboration edit when a remote update arrives during it, and flush each document's queue independently so two documents in one process no longer strand each other.

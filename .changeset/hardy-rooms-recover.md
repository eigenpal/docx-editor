---
'@docx-editor.dev/pro': patch
---

Collaboration rooms recover cleanly from failure: a failed seed no longer marks the room initialized, `readCollaborationDocument` and session teardown release their document observers, refusal recovery keeps a disconnected status instead of reporting ready, and undo obeys the same gate as every other edit. Fixes #541, #542, #544, #545.

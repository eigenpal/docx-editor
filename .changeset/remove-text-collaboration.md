---
'@docx-editor.dev/pro': minor
---

Remove the experimental `createTextCollaboration` and its `PROTOCOL_VERSION`, `SCHEMA_VERSION`, and `MAX_BASELINE_BYTES` exports; use `createDocumentCollaboration`, which now refuses an insert longer than the shared text limit before the edit applies, instead of dropping it.

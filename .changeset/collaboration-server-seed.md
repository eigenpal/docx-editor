---
'@docx-editor.dev/pro': minor
---

Add `createCollaborationState`, which seeds a new collaboration room on the server, so no participant uploads the document or receives its own seed back. A seed document whose expanded size is over the limit now reports `baseline-too-large` instead of `invalid-baseline`, an aborted join now rejects with `initialization-aborted`, also when the room is already present or the server still loads it, and a server refusal after a join keeps the server's reason in the failure detail. Fixes #1383

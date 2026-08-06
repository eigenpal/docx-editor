---
'@docx-editor.dev/pro': patch
---

The review rail renders nothing while the editor is still waiting for its document, instead of floating its empty state and host furniture over the loading screen. `useReview().ready` now reports false until a document is present, matching its documented meaning.

---
'@docx-editor.dev/pro': patch
---

Collaboration status now keeps a typed last-failure reason after the session recovers, so a host can learn why a replica failed. The session factory that always received `"document"` is removed; pass a ready session instead.

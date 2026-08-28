---
'@docx-editor.dev/pro': patch
---

Harden the collaboration receive path against a hostile peer: a malformed shared node record no longer crashes `applyUpdate`, the derived-index rebuild, or the materializer on every replica. A crafted value now degrades to an absent node instead of throwing. Fixes #567.

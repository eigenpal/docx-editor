---
'@docx-editor.dev/core': patch
---

Speed up comment and tracked-change derivation on heavily reviewed long documents: re-reading the review queue over an unchanged document is ~25x faster, and the re-derive after an accept, reject, comment write or undo drops by more than half. Derivation semantics are unchanged.

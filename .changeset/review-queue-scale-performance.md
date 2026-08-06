---
'@docx-editor.dev/core': patch
---

Speed up comment and tracked-change derivation on heavily reviewed long documents: re-deriving the review queue over an unchanged tree is ~25x faster and the re-derive after an accept, reject, comment write or undo drops by more than half, on a 540-page document carrying ~1,900 review items. The per-keystroke content-control gate also no longer re-walks the whole document. Derivation semantics are unchanged.

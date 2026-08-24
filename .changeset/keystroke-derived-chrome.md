---
'@docx-editor.dev/core': patch
---

Typing in a long document no longer rebuilds the review paragraph-order index on every keystroke, and repeated state reads reuse the resolved caret content control instead of re-running the hit test. Replacing a block content-control placeholder now reports the paragraph swap, so review items anchored in the replacement stay activatable.

---
'@docx-editor.dev/core': patch
---

Fixes four write lanes that had drifted from the rules the others follow: Enter inside a tracked insertion now breaks the paragraph at the caret, a table inside a header or footer can be deleted, IME text in suggesting mode is proposed rather than written, and a multi-line paste proposes its paragraph breaks and leaves the caret after the pasted text.

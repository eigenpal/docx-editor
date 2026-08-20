---
'@docx-editor.dev/core': patch
---

Typing no longer rebuilds every visible page. A document carrying a footnotes part — which is nearly every file Word writes, even with no notes in it — discarded every page record on every layout pass, and pressing Enter in a list re-measured every paragraph in the document.

---
'@docx-editor.dev/core': patch
---

Enter on an empty list item leaves the list, the way Word does. Pressing Enter at the end of a list makes another item; pressing it again on that still-empty item now steps out one level, and drops the numbering entirely at the outermost level, instead of making an endless run of empty bullets.

---
'@docx-editor.dev/core': patch
---

Insert Picture and Replace Picture now mint their `wp:docPr` and relationship ids under the collaboration actor, so two people adding an image to the same document at the same time no longer produce colliding ids. A single author still gets Word's dense numbering.

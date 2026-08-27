---
'@docx-editor.dev/core': patch
---

Give each picture its own `wp:docPr` id when two people insert an image into the same document at the same time, so Word no longer renumbers the drawings when it opens the merged file.

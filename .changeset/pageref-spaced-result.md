---
'@docx-editor.dev/core': patch
---

A `PAGEREF` result with spaces now shows once. Table of contents entries in Chinese thesis templates use dashed page numbers such as `- 1 -` (`numberInDash`); the result broke into one span per word and each span painted the whole number, so the entry read `- 1 -- 1 -- 1 -`. Only the first span paints now, as `PAGE` fields already do.

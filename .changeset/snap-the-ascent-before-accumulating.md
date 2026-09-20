---
'@docx-editor.dev/core': patch
---

PDF text baselines now round the font ascent to a device unit before the line advance accumulates, matching where Word places every line after the first in a paragraph.

---
'@docx-editor.dev/core': patch
---

PDF text baselines now round the font ascent to a device unit before the line advance accumulates, so lines after the first in a paragraph no longer drift by a device unit.

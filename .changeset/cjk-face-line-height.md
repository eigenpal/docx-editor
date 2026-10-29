---
'@docx-editor.dev/core': patch
---

Lines drawn in a Chinese, Japanese, or Korean face that is taller than one em now take 1.3 times the height of that face, so documents that use such faces paginate correctly. A character in a run with the East Asian font hint that the East Asian face cannot draw now keeps the Latin face.

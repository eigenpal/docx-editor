---
'@docx-editor.dev/core': patch
---

A table row of merged cells now treats a merge restart that no row continues as a merge head, and a row of continuations beside bottom-to-top text cells takes its first cell's end-of-cell paragraph. A first bottom-to-top cell counts its spacing before, and tables whose repeated header holds a row of continuations keep fast relayout when column widths change.

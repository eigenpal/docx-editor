---
'@docx-editor.dev/core': patch
---

Move the caret by full grapheme clusters on ArrowLeft/ArrowRight so selection never lands inside emoji surrogate pairs or combining sequences.

---
'@docx-editor.dev/core': patch
---

Fix the selection highlight in justified paragraphs: the band is now continuous across stretched inter-word spaces instead of breaking into one block per word. Underline and character shading also continue across those spaces, as Word draws them.

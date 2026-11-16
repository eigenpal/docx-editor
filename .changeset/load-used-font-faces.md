---
'@docx-editor.dev/core': minor
---

Documents show sooner because `packagedFonts()` and `googleFonts()` first load the font faces that the text uses and load the other faces in the background. Set `loading: 'eager'` to load every face before the text shows, or `loading: 'lazy'` to load each face when the text first uses it.

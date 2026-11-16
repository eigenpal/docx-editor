---
'@docx-editor.dev/core': minor
---

`packagedFonts()` and `googleFonts()` first load only the font faces that the document's text uses and load the other faces in the background, and a font picked from the list keeps the text in its previous font until it loads. Font resolvers receive these faces in `FontResolutionRequest.faces`, and `loadDefaultFonts({ faces })` loads single faces.

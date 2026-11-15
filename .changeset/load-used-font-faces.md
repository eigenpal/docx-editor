---
'@docx-editor.dev/core': minor
---

`packagedFonts()` and `googleFonts()` first load only the font faces that the document's text uses, so documents show sooner, and load the other faces of those families in the background. Font resolvers receive these faces in `FontResolutionRequest.faces`, and `loadDefaultFonts({ faces })` loads single faces.

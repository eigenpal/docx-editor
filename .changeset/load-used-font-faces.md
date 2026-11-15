---
'@docx-editor.dev/core': minor
---

`packagedFonts()` and `googleFonts()` load only the font faces that the document's text uses, and fetch the other faces of those families at low priority when the browser is idle. Font resolvers receive these faces in `FontResolutionRequest.faces`, and `loadDefaultFonts({ faces })` and `prefetchDefaultFonts()` load or prefetch single faces.

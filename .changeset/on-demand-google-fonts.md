---
'@docx-editor.dev/react': patch
---

Resolve fonts on demand. `fonts` now also accepts a function, called once per load with the families the document actually declares, so only what a file needs is loaded. `googleFonts()` from `@docx-editor.dev/fonts/google` serves those families from a pinned, hash-checked catalog of 105 Google-hosted families, and `useFonts` gives React a stable `fonts` prop that never rebuilds the editor. App-supplied faces now also paint, through the same aliasing the engine already uses for embedded fonts.

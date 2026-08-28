---
'@docx-editor.dev/fonts': minor
---

Add `packagedFonts()`, which serves the bundled Word substitutes on demand so a document loads only the families it names, and give `useFonts` and `useDocxSource` one uniform origin list where order is precedence. `defaultFonts()` keeps working unchanged.

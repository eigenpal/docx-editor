---
'@docx-editor.dev/fonts': minor
---

Add `packagedFonts()`, which serves the bundled Word substitutes on demand so a document loads the families it names plus its default face, rather than every packaged family, and give `useFonts` and `useDocxSource` one uniform origin list where order is precedence. `defaultFonts()` keeps working unchanged.

---
'@eigenpal/docx-editor-react': minor
'@eigenpal/docx-editor-vue': minor
'@eigenpal/docx-editor-core': minor
---

Add a `fonts` prop on `<DocxEditor>` for declarative custom-font registration — each entry injects an `@font-face` from the URL you provide, and entries sharing a `family` register different weights. Also exposes `loadFontFromUrl`, `loadFontDefinitions`, and the `FontDefinition` type from `@eigenpal/docx-editor-core/utils`. Fixes #620.

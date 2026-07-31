---
'@docx-editor.dev/react': minor
---

`fonts` is now optional on `DocxEditor`, so `<DocxEditor ref={ref} document={bytes} />` is a complete mount. Supplying `t` now renders the full toolbar alongside the title bar instead of the title bar alone.

---
'@docx-editor.dev/react': minor
---

`<DocxEditor ref={ref} document={bytes} />` is now a complete editor on its own: `fonts` is optional, the toolbar renders alongside the title bar, and chrome labels default to the bundled English catalogue instead of requiring a `t` resolver. Pass `chrome={false}` for the painted document alone.

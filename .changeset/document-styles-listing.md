---
'@docx-editor.dev/editor-api': minor
---

Add `Document.getStyles()`, which lists the styles a document defines with read-only `Style` properties such as `nameLocal` and `type`, so you can find a paragraph style name that `paragraph.style` accepts. The `style` reads on paragraphs, ranges, and bodies are now typed `string | null`, matching the `null` they already return when no single style name applies. Fixes #1616.

---
'@eigenpal/docx-editor-core': patch
---

Respect a document's own paragraph defaults instead of forcing the default-template spacing. A DOCX that ships `w:docDefaults` but no `Normal` style (common in generated files) no longer has 8pt after-spacing and 1.08 line spacing injected, so table rows and other unstyled paragraphs render at the compact height the document specifies. New and programmatically created content inherits the document's own `Normal`/`docDefaults`.

Preserve a complex field's run formatting (font size, color) when the field has no separate result run. A footer `PAGE` number whose `w:rPr` lives on the field run now keeps the surrounding text's size and color instead of falling back to the default.

---
'@docx-editor.dev/react': minor
---

Menu bar triggers take an `icon`. `<DocxEditor.Menu.File icon={<Folder />} />` puts a glyph before the label, on the packaged menus and on your own. Unset by default, since neither Word nor Docs shows icons there.

Fixes a clipped descender in the style and font pickers: the truncating label inherited a line box exactly as tall as the font, so "Heading 1" lost the tail of its g.

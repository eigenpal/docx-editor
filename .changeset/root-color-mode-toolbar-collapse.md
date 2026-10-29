---
'@docx-editor.dev/react': minor
---

`DocxEditor.Root` and the Vue `DocxEditorRoot` accept `colorMode`, so composed chrome uses the dark theme like the packaged editor, and a toolbar that runs out of width moves its controls into the `⋯` panel one at a time instead of whole groups. Each toolbar control now sits in a `.docx-toolbar__item` element, so host CSS that targets direct children of `.docx-toolbar__group` needs that level added. Fixes #1613. Fixes #1614.

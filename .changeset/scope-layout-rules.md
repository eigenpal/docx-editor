---
'@docx-editor.dev/core': patch
---

The painted-document rules are now scoped to the editor. Around a hundred `.layout-*` and `.paged-editor*` selectors shipped unscoped, so a host with its own `.layout-page-header` or `.layout-page-content` had those elements restyled by the editor's stylesheet. The class names are unchanged; only the rules moved under `.docx-editor`. The stylesheet guard now exempts `.docx-` alone, so nothing else can ship unanchored.

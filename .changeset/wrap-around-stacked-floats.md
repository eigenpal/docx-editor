---
'@eigenpal/docx-editor-core': patch
'@eigenpal/docx-editor-react': patch
---

Body text now flows around stacked floating objects correctly. Documents with a side-anchored textbox plus an image floating to the right, or with a floating table whose width fills the page, used to render body paragraphs at full content width on top of the floats, push tables to the page top, or collapse the first paragraph to a single glyph per line. All three cases now match Word's layout.

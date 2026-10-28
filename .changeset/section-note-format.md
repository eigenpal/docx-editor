---
'@docx-editor.dev/core': patch
---

A section that authors its own footnote or endnote properties without a number format now numbers its notes in the default format, as Word does, instead of inheriting the document-wide format from settings.xml. A document whose settings use `chicago` for a title-page note no longer shows every body note as a symbol. The final section's note properties are also read from the body-level `w:sectPr` in the notes layout and NOTEREF numbering, as the note properties state already did.

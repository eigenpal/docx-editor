---
'@eigenpal/docx-js-editor': patch
---

Fix paragraph default font family resolution when a paragraph's pPr/rPr sets only one slot of `<w:rFonts>` (e.g. `w:eastAsia="Calibri"`). Previously the entire fontFamily object was replaced on merge, wiping out other slots inherited from the basedOn chain (e.g. `w:ascii="Arial Narrow"`). Per ECMA-376 §17.3.2.27, each ascii/hAnsi/eastAsia/cs slot — and its theme pair — must merge independently. Identical paragraphs now resolve to the same default font family and render at the same height.

---
'@eigenpal/docx-editor-react': patch
---

Fix inline-image header lines to match Word. A line with a tall inline logo plus short text now baseline-aligns the label with the image bottom instead of centering it in an inflated line box, so it hugs the paragraph border. Inline images also honor their `wp:inline` distT/distB wrap distances, which previously only the block-image path applied.

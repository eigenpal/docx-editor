---
'@eigenpal/docx-js-editor': patch
---

Inline images in table cells now have visual breathing room. Previously when an image was taller than the parent paragraph's text line height, the line height was overwritten with the bare image height — so an image alone in a table cell rendered flush with the cell borders. Word treats an inline image as a tall glyph sitting on the text baseline: the image extends above the baseline (full ascent) and the line still reserves the parent font's normal descent + leading below. The line now grows to image-height + text-line-height, giving cells natural padding around image-dominant lines.

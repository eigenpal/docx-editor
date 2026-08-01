---
'@docx-editor.dev/core': patch
---

A list marker now follows the formatting of the paragraph it numbers. Sizing a bulleted paragraph left a tiny bullet beside large text, because the marker inherits its face from the paragraph mark (`w:pPr/w:rPr`) and nothing ever wrote it. Formatting that covers a whole paragraph now writes the mark as well, the way Word does, so the bullet grows, bolds and colours with its text. Formatting part of a paragraph leaves the mark, and therefore the marker, alone.

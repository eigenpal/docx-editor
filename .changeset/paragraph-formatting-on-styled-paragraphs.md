---
'@docx-editor.dev/react': patch
---

Alignment, indent and other paragraph formatting now work on styled paragraphs. Pressing Centre on a heading, or on a list item authored in Word, no longer does nothing, and a paragraph keeps inheriting from its style instead of having the style's values frozen onto it. A paragraph whose properties Word wrote in an order the reader did not model also renders with its own alignment, indent, numbering and style again.

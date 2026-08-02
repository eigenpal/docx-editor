---
'@docx-editor.dev/react': patch
---

Increase and Decrease Indent now rewrite the indent a paragraph already states rather than adding a second, different one beside it, so a paragraph written with the direction-relative spelling moves by the same amount here as in Word. Pressing undo with nothing to undo no longer makes the next repaint discard a selection made since.

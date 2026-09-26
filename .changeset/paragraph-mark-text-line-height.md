---
'@docx-editor.dev/core': patch
---

A larger paragraph mark no longer makes the last line of its paragraph taller when that line holds text, superscript or subscript text, an inline picture, or an equation; a line with only inline pictures takes the text height of the runs that hold them, and a larger paragraph style size no longer makes a superscript or subscript last line taller. Empty paragraphs and empty last lines still take the mark's height.

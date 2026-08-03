---
'@docx-editor.dev/react': minor
---

Wire superscript, subscript and Clear Formatting. The two script controls toggle `w:vertAlign` and are mutually exclusive, with Word's Ctrl+= and Ctrl+Shift+= shortcuts. Clear Formatting is Word's eraser: direct character formatting off the selection, and every paragraph it touches back to the default style. Adds the `clearFormatting` editor command.

---
'@eigenpal/docx-editor-core': patch
---

Fix inline images overlapping following text when they wrap to their own line, and custom-style list fidelity: zero-padded custom numbering renders as in Word (`[0001]`), picking a numbered style from the toolbar now attaches its numbering and indents, style-attached numbering keeps the style's indents over the level's, and removing a style's numbering no longer hangs the first line back to the margin. Fixes #765, fixes #766.

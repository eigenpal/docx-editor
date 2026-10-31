---
'@docx-editor.dev/core': patch
---

Replacing a checkbox content control's glyph with its checked or unchecked glyph now changes the checkbox state inside the control, and other replacement text is refused instead of emptying the control. Fixes #1144.

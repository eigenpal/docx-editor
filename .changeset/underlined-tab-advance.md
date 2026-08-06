---
'@docx-editor.dev/core': patch
---

Paint form-blank underlines across tab advances: an underlined `w:tab` now draws a rule for the reserved stop width instead of relying on CSS text-decoration on an invisible tab glyph.

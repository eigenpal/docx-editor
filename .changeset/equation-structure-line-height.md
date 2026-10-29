---
'@docx-editor.dev/core': patch
---

Equation lines with scripts and fractions now take the height of their glyphs, later scripts and fractions take their offsets from the size of the first run, and multiple line spacing adds its share of the text height below an equation instead of keeping the equation as a minimum. Fixes #1591.

---
'@docx-editor.dev/core': minor
---

Equation scripts and bars take their size from the structure's control properties, or from the text around the equation, and a tall subscript drops below its limit; `EquationExpression` structures carry the control size as `controlFontSizePt`. Fixes #1539.

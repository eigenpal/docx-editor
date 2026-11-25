---
'@docx-editor.dev/core': patch
---

Text in a font family that your font resolver serves for some faces keeps that family after more faces load in the background, and its missing faces draw as a synthesized style of that family in the editor and in PDF export. Before, a fallback face could paint all text of the family, so painted lines did not match the measured width.

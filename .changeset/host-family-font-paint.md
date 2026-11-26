---
'@docx-editor.dev/core': patch
---

Text in a font family that your font resolver serves for some faces now paints at the width that layout measures, and its missing faces draw as a synthesized style of that family in the editor and in PDF export. A family whose faces your resolver maps to several target families still paints through the regular face's target.

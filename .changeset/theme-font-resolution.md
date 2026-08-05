---
'@docx-editor.dev/react': patch
---

Render documents in their theme fonts. A template that states its fonts through the theme (`w:asciiTheme="minorHAnsi"` in `w:docDefaults`, `majorHAnsi` on heading styles) names no concrete family anywhere, so every run fell back to the default face and the document rendered in the wrong font even when the author's fonts were installed.

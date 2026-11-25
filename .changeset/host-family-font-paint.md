---
'@docx-editor.dev/core': patch
---

Text in a font family that your font resolver serves keeps that face after more faces load in the background. Before, a fallback face for a face that the resolver did not serve could paint all text of the family, so lines ran wider than layout measured.

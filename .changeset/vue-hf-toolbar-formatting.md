---
'@eigenpal/docx-editor-vue': patch
---

Fix the Vue formatting toolbar not applying to a header or footer while editing it. Bold, italic, font, size, color, paragraph style, and clear-formatting now target the header/footer being edited instead of the document body. Fixes #749.

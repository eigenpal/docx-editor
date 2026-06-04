---
'@eigenpal/docx-editor-core': patch
'@eigenpal/docx-editor-vue': patch
---

Fix text selection not showing in Vue headers and footers. Selecting text while editing a header or footer now paints the highlight (the body overlay was suppressed in HF mode but the HF rects were never drawn), and double/triple-click word and paragraph selection resolves against the header/footer text instead of a body run at the same position. On multi-page documents, the caret and selection now render on the header/footer instance being edited rather than always on page one's copy. Fixes #691

---
'@eigenpal/docx-editor-core': patch
---

Paste from Word now keeps text and formatting instead of inserting a bitmap snapshot of the selection. When the clipboard carries rich HTML alongside an image, the editor routes it through the normal paste pipeline (both keyboard paste and the Vue right-click Paste). Fixes #981

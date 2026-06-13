---
'@eigenpal/docx-editor-vue': patch
---

Fix the Vue image selection frame being shifted right (misaligned) on platforms with classic scrollbars. The overlay now accounts for the inline-start scrollbar gutter reserved by `scrollbar-gutter: stable both-edges`.

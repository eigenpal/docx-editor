---
'@docx-editor.dev/core': patch
---

Punctuation compression, kana compression, and hanging punctuation now turn on for documents whose default East Asian font is Osaka, Nanum Gothic, Klee Medium, Klee One, or a font named in East Asian characters, and turn off for Hiragino, PingFang, and Heiti unless the font table marks them as East Asian. Picking Osaka in the font menu now also sets the East Asian font. Fixes #1725.

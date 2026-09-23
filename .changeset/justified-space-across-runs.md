---
'@docx-editor.dev/core': patch
---

Justified paragraphs now compress inter-word spaces to fit a word when the space after that word is in a separate run or the paragraph uses an East Asian language, so these lines no longer wrap one word early. Justified lines that end in a double space split across runs now fill the full line width.

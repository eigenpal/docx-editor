---
'@docx-editor.dev/core': patch
---

A numbered paragraph that holds only a section break no longer shows a list number or advances the count, as in Word. Chinese thesis templates put such a paragraph, in the numbered `heading 1` style, before each chapter. Before this change, every chapter after the first showed the next chapter's number, such as `第三章` for the second chapter, and `STYLEREF` header fields with `\n` showed the same wrong number.

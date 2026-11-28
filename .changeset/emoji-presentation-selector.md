---
'@docx-editor.dev/core': patch
---

A character followed by the emoji variation selector, such as a heart with U+FE0F, and keycap and joined emoji sequences render from the color emoji face even when the run's font has a text glyph for them. Characters without the selector keep the run's font.

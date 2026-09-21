---
'@docx-editor.dev/core': patch
---

Text shaping accepts a color font that also carries outlines, and export glyph fallback tries color emoji faces first for emoji-presentation text and last for everything else, so a dingbat stays a symbol glyph while an emoji keeps its color face.

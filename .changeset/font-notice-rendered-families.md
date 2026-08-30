---
'@docx-editor.dev/core': minor
---

The font-substitution notice now reports only families that rendered text resolves to through the style cascade, so declarations in unused styles no longer trigger it. Adds `renderedFontFamilies()` to the tree session.

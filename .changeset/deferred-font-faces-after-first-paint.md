---
'@docx-editor.dev/core': minor
---

Large fonts can load after the document first paints: `cjkFonts()` does so by default, `googleFonts({ cjk: true })` serves regional Noto Sans faces for Chinese, Japanese, and Korean families, and `deferFonts()` moves any font origin to the background. Documents that use font resolvers also open sooner, because the text shaper downloads alongside the fonts.

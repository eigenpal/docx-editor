---
'@docx-editor.dev/core': minor
'@docx-editor.dev/fonts': major
---

Improve Word fidelity for theme fonts, RTL numbers, floating-table passages, and narrow CJK punctuation.

Breaking: font registration now always uses private editor aliases. The deprecated `packagedFonts.install` option is ignored, including `true`. The deprecated `installDefaultFontFaces()` helper does nothing and resolves to `0`. Remove these options and helper calls. Supply fonts through the editor's `fonts` option, and configure any application fonts separately.

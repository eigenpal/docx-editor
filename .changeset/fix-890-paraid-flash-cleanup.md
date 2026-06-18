---
'@eigenpal/docx-editor-agents': patch
---

The agent bridge now re-exports the paragraph-flash option types (`ParagraphHighlightOptions`, `ScrollToParaIdOptions`) from `@eigenpal/docx-editor-core` instead of redeclaring them, so the two definitions can't drift. No change to the public API surface.

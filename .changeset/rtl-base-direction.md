---
'@eigenpal/docx-editor-core': patch
---

Right-to-left paragraphs now render in the correct reading order. A paragraph whose runs are marked right-to-left (`w:rtl`) but that carries no explicit bidi flag is laid out right-to-left based on its first strong character, so Hebrew and Arabic text no longer reads left-to-right. Alignment and indentation mirror to match. Fixes #719.

---
'@docx-editor.dev/core': minor
---

Add `editor.getParagraphs()` and `editor.getParagraphText()` to read the accepted text of each paragraph with its language and proofing settings, and the `replaceAcceptedText` command to fix a range of that text. `acceptedTextRanges()`, `acceptedOffsetFromText()`, and `textOffsetFromAccepted()` convert its offsets, and highlight counts update as a large document finishes its layout.

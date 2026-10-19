---
'@docx-editor.dev/core': minor
---

The editing API adds `Range.getTextRanges`, `Paragraph.getTextRanges`, `Range.expandTo`, and `Range.getRange`, so an agent can split a paragraph into word ranges and replace, delete, or insert after a run of words. `Range.getReviewedText` and `Paragraph.getReviewedText` read text as if every pending tracked change were accepted or rejected, and `Range.contentControls` and `Paragraph.contentControls` list the content controls a range or paragraph overlaps.

---
'@docx-editor.dev/core': minor
---

Inline pictures now lay out, take the caret, and show the paragraph mark in their correct positions: text typed after a picture follows it directly, a picture reads in its paragraph's direction in right-to-left text, a picture that does not fit before a floating object continues past it on the same line, and the paragraph mark sits on the text baseline. Layout records gain `InlineDrawingRecord.bidiLevel` and `ParagraphFragmentRecord.paragraphMarkStyle`, and `LineRecord.contentX` includes a leading inline picture. Fixes #1058

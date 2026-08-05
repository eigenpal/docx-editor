---
'@docx-editor.dev/react': patch
---

Typing at the outer edge of an inline container that ends the paragraph — a hyperlink or a locked content control — now places the text beside it instead of into the wrong run or refusing the keystroke. Typing at a locked control's leading edge lands before it. Validation and the write path now attribute boundary carets with the same rule.

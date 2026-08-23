---
'@docx-editor.dev/core': patch
---

Fixed IME text being dropped when you compose into an empty paragraph, and fixed a composition deleting an inline image or hidden text elsewhere in the same paragraph. Composing over a selection that spans two paragraphs now replaces the whole range in one step. Text in a header, a repeating table header row, or a footnote referenced twice no longer duplicates when you compose into it.

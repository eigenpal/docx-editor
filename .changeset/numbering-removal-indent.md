---
'@docx-editor.dev/core': patch
---

A paragraph that removes its numbering with `w:numId w:val="0"` now starts at the margin instead of keeping the left and first-line indents of its style. A right indent or an indent stated on the paragraph itself still applies.

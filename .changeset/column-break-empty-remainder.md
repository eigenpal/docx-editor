---
'@docx-editor.dev/react': patch
---

Keep the empty line Word shows at the top of a column after an explicit column break. A paragraph whose only content is `w:br w:type="column"` still occupies its remainder line in the next column; page breaks continue to open the next page flush with the following block.

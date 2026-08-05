---
'@docx-editor.dev/react': patch
---

Paragraph borders honour common OOXML line styles. A thin `w:val="double"` rule (including the end-of-document separator in the comprehensive fixture) now paints as two parallel lines instead of collapsing to a single hairline, and dashed/dotted/3-D approximations follow the same layout-owned thickness as table borders.

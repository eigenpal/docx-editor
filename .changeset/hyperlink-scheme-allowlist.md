---
'@eigenpal/docx-editor-core': patch
---

Allowlist URL schemes on hyperlink and image-hyperlink targets parsed from DOCX relationships and pasted HTML; `javascript:`, `data:`, and other non-web schemes are now dropped.

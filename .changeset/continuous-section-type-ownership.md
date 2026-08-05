---
'@docx-editor.dev/react': patch
---

Continuous section breaks now honour `w:type` on the section being started (ECMA-376), so a next-page section followed by a continuous TOC body no longer inserts a spurious page break. Mid-page margin changes on the same paper size stay on the shared sheet.

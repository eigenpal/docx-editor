---
'@docx-editor.dev/core': patch
---

An `=` formula field with arithmetic over `PAGE`, `NUMPAGES`, and `SECTIONPAGES` fields, such as `{ = { PAGE } + 1 }` or `{ = { NUMPAGES } - { PAGE } }`, now shows the value for each page instead of its saved result. Page fields and formulas inside another field's result also update in the body.

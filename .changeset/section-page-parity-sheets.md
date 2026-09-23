---
'@docx-editor.dev/core': minor
---

Odd-page and even-page sections, and sections that restart page numbering when odd and even pages differ, now start on a page of the correct parity, with one empty sheet inserted when needed and marked by `PageRecord.parityBlank`. Sheets after section-end note sheets or a continuous section now continue the running page number, and `w:evenAndOddHeaders` with the value `off` now turns different odd and even pages off.

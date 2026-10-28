---
'@docx-editor.dev/core': patch
---

Text no longer disappears from runs, paragraphs, and tables whose markup is out of order, repeated, or nested, and repeated run, paragraph, and table properties now combine instead of only the first applying. Text in `w:t` without `xml:space="preserve"` now drops its leading and trailing spaces.

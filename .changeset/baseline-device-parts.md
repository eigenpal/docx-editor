---
'@docx-editor.dev/docx-to-pdf': patch
---

PDF export places text baselines more accurately. Single-spaced lines, lines with a minimum or exact line height, and the first and last lines of paragraphs with space before or after no longer paint a fraction of a point too high or too low. Runs in different fonts on one line share one baseline.

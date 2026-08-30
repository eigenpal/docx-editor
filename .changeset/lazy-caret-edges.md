---
'@docx-editor.dev/core': patch
---

Layout no longer eagerly measures per-character caret edges for every laid span; caret and hit-test positions are measured on demand through the same measurer, and the selection-rect APIs accept an optional measurer for exact intra-span edges. Repagination after a page-boundary edit costs about a third of before. Fixes #632

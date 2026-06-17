---
'@eigenpal/docx-editor-agents': patch
---

Fix `DocxReviewer.getChanges()` dropping a tracked change when two changes in different paragraphs share a revision id (Word reuses `w:id` across paragraphs), which made the enumerated change list disagree with the count from `acceptAll`/`rejectAll`.

---
'@docx-editor.dev/telemetry': patch
---

Log records from `toLogRecord` carry `occurrences` and `failures` counts, and `failureCount` totals failures including deduplication summaries. Events with numbers the editor cannot produce are dropped.

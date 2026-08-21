---
'@docx-editor.dev/core': patch
---

Typing latency in very long documents drops further: layout reuses each unchanged section's whole prepass, list numbering, font catalogs, drawing scans, and note-mark projection reuse memoized answers across keystrokes, and shaped text measurement stops rebuilding string keys per probe.

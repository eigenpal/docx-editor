---
'@docx-editor.dev/pro': minor
---

Breaking collaboration upgrade (format `docx-collaboration:1.5.3.1`). Concurrent splits of one paragraph keep every split in text order, and rejecting a proposed paragraph break while its author undoes it keeps the paragraph; export saved rooms with your current release and reseed them, as described in https://docx-editor.dev/pro/collaboration-versions#upgrade-rooms-to-format-1531. Fixes #1654.

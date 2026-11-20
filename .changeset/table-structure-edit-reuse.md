---
'@docx-editor.dev/core': patch
---

Inserting, deleting, or growing rows in a long table lays out and repaints less of it: the pages above the edited row stay as they are, and rows that only move keep their layout and their painted content, also when they move to another page.

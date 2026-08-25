---
'@docx-editor.dev/core': patch
---

Fix tracked replacements over a rectangle of table cells to land in the first cell after its struck content, and allow `proposeReplacement` to span paragraph marks with the same landing rule as typing. Text-carrying proposals (`proposeInsertion`, `proposeReplacement`, and the matching `proposeTextChange` kinds) now refuse empty or newline-containing text instead of committing it. Fixes #459

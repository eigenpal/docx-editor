---
'@docx-editor.dev/core': patch
---

`AUTONUM`, `AUTONUMLGL`, and `AUTONUMOUT` fields now paint a synthesized sequential number (one counter per kind, in document order, with `\*` format switches and `\e`) instead of nothing, and `REF` number switches resolve against bookmarked auto-numbered paragraphs. Fixes #618.

---
'@docx-editor.dev/editor-api': minor
---

`insertText()` on a body, paragraph, or range now treats `\n`, `\r`, and `\r\n` as paragraph breaks, and with `TrackMineOnly` it proposes each new paragraph mark as a tracked insertion.

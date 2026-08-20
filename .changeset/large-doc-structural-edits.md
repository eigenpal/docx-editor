---
'@docx-editor.dev/core': patch
---

Pressing Enter or Backspace in a large multi-section document no longer relays the whole document; layout now reuses unchanged sections and whole pages shifted by the edit, and typing latency in 500+ page documents drops sharply.

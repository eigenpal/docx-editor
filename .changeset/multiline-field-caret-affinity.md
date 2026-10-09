---
'@docx-editor.dev/core': patch
---

Keep a clicked field boundary on its visual line instead of moving to the first or last result line. Use the same preference for caret paint, the native selection, and scrolling. Preserve model offsets and saved document content. Add an optional preferredLineId to caretAt options, with normal fallback for stale preferences.

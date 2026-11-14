---
'@docx-editor.dev/core': patch
---

Header, footer, note, content-control, and context-menu chrome, the drawing selection frame, and table controls no longer re-render or re-bind listeners on frames and keystrokes that change nothing. A snapshot read during fast typing now reports the typed state.

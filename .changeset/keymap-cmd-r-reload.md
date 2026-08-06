---
'@docx-editor.dev/core': patch
---

Stop binding Cmd+R for right alignment on macOS: the browser reserves that chord for reload, so the old binding re-aligned the paragraph and the page still reloaded. Right alignment stays on Ctrl+R on every platform.

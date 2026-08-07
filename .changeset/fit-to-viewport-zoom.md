---
'@docx-editor.dev/core': minor
---

The document now fits its container by default, so a narrow window shrinks the page instead of overflowing it and opening the comments pane shrinks the document rather than pushing it off screen. Drive it with `Editor.setZoomMode` or React's new `useZoom` hook, and pass `zoomMode={{ type: 'fixed' }}` to keep the old behavior.

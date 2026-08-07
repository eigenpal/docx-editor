---
'@docx-editor.dev/core': minor
---

The document now fits its container by default: a narrow window shrinks the page instead of overflowing it, and opening the comments pane shrinks the document rather than pushing it off screen. Fitting stops at 50%, below which the page keeps a legible size and the container scrolls. Drive it with `Editor.setZoomMode` or React's new `useZoom` hook; pass `zoomMode={{ type: 'fixed' }}` to keep the old behavior.

---
'@docx-editor.dev/core': minor
---

The document now fits its container by default: a narrow window shrinks the page instead of overflowing it, opening the comments pane shrinks the document rather than pushing it off screen, and below a threshold the comments open as a drawer. Drive it with `Editor.setZoomMode` or React's new `useZoom` hook; pass `zoomMode={{ type: 'fixed' }}` to keep the old behavior.

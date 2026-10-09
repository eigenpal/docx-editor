---
'@docx-editor.dev/core': minor
'@docx-editor.dev/pro': minor
---

Add the `revisionsIn`, `commentMarkers`, and `overflow: 'scroll'` review pane settings for tracked-change balloons, comment marker style, and a pane that does not fit. Collapsed comment markers now show the author's initials by default; to keep the comment icon, pass `commentMarkers: 'icon'` to `reviewModule({ pane })` or `editor.setReviewPaneOptions()`.

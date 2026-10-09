---
'@docx-editor.dev/core': minor
'@docx-editor.dev/pro': minor
---

Add the `revisionsIn`, `commentMarkers`, and `overflow: 'scroll'` review pane settings for tracked-change balloons, comment marker style, and a pane that does not fit, and show collapsed comment markers as miniatures with up to three author initials, the reply count, and a ring that lifts them off the page. To keep the comment icon, pass `commentMarkers: 'icon'` to `reviewModule({ pane })` or `editor.setReviewPaneOptions()`.

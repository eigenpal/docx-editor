---
'@docx-editor.dev/pro': minor
---

Add the `revisionsIn`, `commentMarkers`, and `overflow: 'scroll'` review pane settings, which open tracked changes in balloons at their text, choose the comment marker style, and keep the page size beside a review pane that does not fit. Collapsed comment markers now show the author's initials by default; to keep the comment icon, pass `reviewModule({ pane: { commentMarkers: 'icon' } })` or call `editor.setReviewPaneOptions({ commentMarkers: 'icon' })`.

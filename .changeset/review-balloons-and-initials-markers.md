---
'@docx-editor.dev/pro': minor
---

Add the `revisionsIn`, `commentMarkers`, and `overflow: 'scroll'` review pane settings, which open tracked changes in balloons at their text, choose the comment marker style, and keep the page size beside side panes that do not fit. Collapsed comment markers now show the author's initials by default; to keep the comment icon, pass `reviewModule({ pane: { commentMarkers: 'icon' } })` or call `editor.setReviewPane({ commentMarkers: 'icon' })`.

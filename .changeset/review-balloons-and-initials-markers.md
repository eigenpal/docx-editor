---
'@docx-editor.dev/pro': minor
---

Add the `revisionsIn` and `commentMarkers` revision markup preferences: `revisionsIn: 'balloons'` keeps comments in the review pane and opens each tracked change in a balloon at its text, and the default `commentMarkers: 'avatar'` draws collapsed comment markers as author initials badges with a reply count and a resolved check. Both work through `setRevisionMarkup`, the `revisionMarkup` prop, and the Track changes options dialog, and the comment reply box uses a compact reply line.

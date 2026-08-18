---
'@docx-editor.dev/core': minor
---

Tracked changes on a paragraph mark now reach the page: both halves of an insert-then-delete pair are read instead of the first, a mark inside a table cell is drawn at all, the margin gets its change bar, and a resolved view draws no attribution. Renumbering a footnote and any field a fragment publishes now take part in incremental layout reuse, so a page that was reused no longer shows a value the document has moved past.

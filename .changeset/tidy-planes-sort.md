---
'@docx-editor.dev/core': major
---

Tracked changes are now colored per author by default, the way Word shows them, and review cards carry each author's color. Mount `DocxEditor.AuthorStyle` to give a named author their own color, background, class names, or avatar, or `DocxEditor.ColorByChangeType` to keep the previous green-and-red rendering.

Comment authors share the same colors, and every element with an author — painted spans, comment highlights, cards, balloons, and markers — carries `data-review-author` and `data-review-author-slot`. This renames the painted span's `data-revision-author` and the `--doc-review-author` custom property, which is now `--doc-review-author-current`; update any CSS that used the old names. Read the roster with `useReviewAuthors()` or `editor.getReviewAuthors()`.

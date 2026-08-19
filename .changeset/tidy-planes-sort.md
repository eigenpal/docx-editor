---
'@docx-editor.dev/core': minor
---

Tracked changes are now colored per author by default, the way Word shows them, and review cards carry each author's color. Mount `DocxEditor.AuthorStyle` to give a named author their own color, background, class names, or avatar, or `DocxEditor.ColorByChangeType` to keep the previous green-and-red rendering.

Comment authors share the same colors, and the highlight over commented text carries `data-author`, `data-author-slot`, and `--doc-review-author` for styling it per reviewer. Read the roster with `useReviewAuthors()` or `editor.getReviewAuthors()`.

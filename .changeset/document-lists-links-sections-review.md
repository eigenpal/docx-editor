---
'@docx-editor.dev/agents': minor
---

Reach a document's lists, bookmarks, hyperlinks, sections, headers, footers, notes, comments and tracked changes from the document object model.

`body.lists` and `paragraph.list` reach the numbering a story applies: a list answers its identifier and its paragraphs, `list.getLevelParagraphs(level)` answers the ones at a level, `paragraph.listItem.level` reads and moves an item between levels, and `list.insertParagraph` adds an item that is numbered with the rest of the list. `range.bookmarks` answers the bookmarks a stretch of the story carries, each with its name and the range it covers, and `range.hyperlink` reads a link's target and sets it — every target is sanitized before a relationship is written, and a scheme the engine will not open is refused rather than stored.

`document.sections` reaches each section, its page setup — page size, orientation and the four margins, in points — the header and footer it declares or inherits from the section before it, and the section after it. Setting page setup writes into that section alone. A header, a footer and a footnote body are ordinary bodies: they read their text, list their paragraphs, and are written to exactly like the main story, each edit landing in its own part. `document.footnotes` and `document.endnotes` reach the notes a document holds, each answering its kind and its body, and a note can be deleted.

`document.comments` and `body.getComments()` answer the threads a document holds — who wrote each one, when, what it says, what it is anchored to, and whether it is resolved — with the replies under it. Replying adds a reply the way the review rail does, and resolving marks the whole thread done. `document.revisions` answers the tracked changes in a story, each with its author, date, kind and range, and each can be accepted or rejected, as can all of them at once.

Every one of these reads the same values the editor's own review and layout code reads, so a script and the page cannot disagree. Writes stay one batch or nothing, and a batch still addresses one story at a time, so an edit to a header is refused rather than half-applied alongside an edit to the body.

Structural tracked changes — a row, a cell, the grid, a section's properties — are not reported, because accepting or rejecting one is refused and a document must not offer a decision it cannot make; the markup is preserved either way. Replacing a comment's body, deleting a comment, deleting a bookmark, and a list item's rendered marker text are recorded as deliberate omissions with a reason each.

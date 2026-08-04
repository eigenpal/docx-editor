---
'@docx-editor.dev/agents': minor
---

Read and write character formatting and paragraph formatting through the document object model. `body.font`, `range.font` and `paragraph.font` read and set bold, italic, colour, font name and size; a paragraph also reads and sets its own alignment, first-line, left and right indents, line spacing, and the space before and after it, all in points. A read over a stretch of a story answers the value every character or paragraph in it agrees on, and `null` where they disagree or where nothing sets the value — so a value that is read back is a value that was actually authored, not one inherited from a style.

`body.style`, `range.style` and `paragraph.style` read and apply a paragraph style by the name the styles gallery shows, resolved against the document's own styles. A name the document does not already define is refused rather than created: a style minted on demand would report itself applied while the text stayed exactly as it looked.

Setting several properties in one batch is one write. A write only ever changes what it names — the properties a paragraph or a run already carried, including its numbering and its style, are preserved — and a refused write leaves the document exactly as it was.

Lists, bookmarks, hyperlinks, sections and page setup, header/footer and note bodies, comments and tracked changes are not part of this surface. They are recorded as deliberate omissions with a reason each rather than shipped as members that would answer values the engine cannot supply.

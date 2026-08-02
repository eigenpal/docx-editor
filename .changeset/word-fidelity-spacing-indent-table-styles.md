---
'@docx-editor.dev/react': patch
---

Line spacing is now honoured. `w:spacing` with `w:line` and `w:lineRule` resolves for single, multiple, exactly and at-least, so a 1.5- or double-spaced document breaks pages where Word breaks them. Word's own Normal style is 1.08, so this shifts almost every document.

First-line and hanging indents reach line geometry. An indented first line starts where Word starts it and wraps with the room it actually has, instead of being flush with the rest of the paragraph.

`w:contextualSpacing` drops the gap between consecutive paragraphs of the same style, which is what Word's List Paragraph style relies on for lists.

Table styles resolve. Borders, cell margins and conditional formatting (header row, total row, first and last column, row and column banding) come from the named style through its `basedOn` chain, gated by `w:tblLook`, with an explicit `w:cnfStyle` taking precedence. A table using Word's Table Grid style now draws its grid.

Document-embedded fonts are measured with the same face they are painted with, so line breaks and page breaks match the glyphs on screen.

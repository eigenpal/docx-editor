---
'@docx-editor.dev/core': patch
---

Indenting a list item no longer destroys it. A `w:abstractNum` need not declare all nine levels — many real documents declare only the first — and moving a paragraph to a level its definition does not declare left it with no marker at all: the bullet or numeral vanished and the text sprang back to the margin. The move is now refused, and Increase and Decrease Indent report themselves disabled when they would do nothing, so the toolbar greys them out the way Word does.

A list's kind is read from its `w:numFmt` rather than the shape of its marker glyph. Word's own default list uses a Courier `o` and a Wingdings `§` at the inner levels, so sniffing the character reported half of every multi-level bullet list as numbered and lit the wrong toolbar button.

Turning a bullet off and back on rejoins the list around it instead of minting a new definition, so the restored item keeps its neighbours' glyph.

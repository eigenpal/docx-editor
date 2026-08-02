---
'@docx-editor.dev/react': patch
---

List markers follow Word more closely.

A list whose numbering is defined on a style — the shape Word's own List Bullet and List Number use — now renders its bullets and numbers instead of nothing at all. Number formats Word supports beyond digits and letters are rendered as Word renders them: `none` prints nothing rather than inventing a number, and `ordinal`, `ordinalText`, `cardinalText`, `hex`, `chicago` and `numberInDash` print their real form. Legal numbering shows every level of the number in decimal.

The space between a marker and its text follows the document: a space or nothing where the list asks for one, and a marker too wide for its indent now pushes the first line along instead of being drawn over the first word. Lists indented into the page margin stay there rather than snapping back to the text edge.

Symbol and Wingdings bullets, which Word stores as private-use codepoints, render as their intended glyph instead of an empty box when the font is not installed.

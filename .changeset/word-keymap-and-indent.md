---
'@docx-editor.dev/core': patch
---

Increase and Decrease Indent are wired to the toolbar. Inside a numbered or bulleted list they change the list level, so the marker re-resolves from the numbering definition the way Word demotes an item; everywhere else they move the left indent by one default tab stop and never past the margin.

The keymap now covers Word's paragraph shortcuts: Tab and Shift+Tab demote and promote inside a list, Ctrl+Enter inserts a page break, Ctrl+M and Ctrl+Shift+M indent and outdent, Ctrl+E/L/R/J set alignment, Ctrl+1/5/2 set line spacing, Ctrl+Backspace and Ctrl+Delete delete a word, and Ctrl+Y redoes.

Page Up and Page Down move by one page instead of jumping to the start or end of the document; Ctrl with either still goes to the document edge.

Setting a paragraph property no longer discards the parts of `w:pPr` it does not name. Centring a list item used to delete its numbering and the bullet disappeared.

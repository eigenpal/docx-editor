---
'@docx-editor.dev/core': patch
---

Tab leaders render. A tab that reaches a stop declaring `w:leader` now fills its advance with the leader glyph, so a Word table of contents keeps the dots between each heading and its page number. The document's own `w:defaultTabStop` is honoured as well, in headers and footers as well as the body, so a metric-locale tab grid lands where Word puts it instead of on a hardcoded half-inch.

Hidden text is no longer rendered. A `w:vanish` run is not measured, laid out or painted, so it stops occupying space and moving page breaks; the text still round-trips.

Table styles now carry paragraph and run formatting. A conditional format's `w:pPr` and `w:rPr` reach cell content, so a header row comes out bold and centred the way the style says, instead of in body formatting.

A vertically merged cell that crosses a page break keeps its borders and shading on the continuation page. It previously left a hole in the border grid where Word repeats the cell.

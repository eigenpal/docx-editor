---
'@docx-editor.dev/react': patch
---

Render pictures whose `pic:spPr` or `pic:blipFill` omit optional children. `a:xfrm`, the geometry group and the fill-mode group are all optional in ECMA-376, but each was being required, so a conforming picture was treated as unrecognised content and never drawn. Word writes all of them, which is why this only showed up on files from other producers.

Size the caret on an empty spaced paragraph to the text rather than the line box. Auto and at-least line spacing add their extra depth below the glyphs, so on a double-spaced empty paragraph the caret was drawn at the full height of the spaced box — about twice the height of the text about to be typed. The same measurement also fixes the highlight band a content control draws on such a line.

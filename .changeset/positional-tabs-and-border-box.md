---
'@docx-editor.dev/react': patch
---

Three rendering fixes. Positional tabs (`w:ptab`) lay out: a table-of-contents line authored with one now advances to its stated position and draws its leader, instead of running the entry and the page number together with no dots between them. A hard line break at the end of a paragraph opens the empty line it should, so the caret after a Shift+Enter sits at the start of the new line rather than beside the last glyph of the one above. A bordered paragraph's shading fills the rectangle its borders draw, padding included, and the top and bottom rules reach the side rules so the frame closes at the corners.

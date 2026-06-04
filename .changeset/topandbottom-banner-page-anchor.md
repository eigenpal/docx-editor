---
'@eigenpal/docx-editor-core': patch
---

Render anchored text boxes with `topAndBottom` wrapping at their OOXML position instead of in the body flow. A title banner pinned to the top of the page (a shape with `wp:wrapTopAndBottom` and a page-relative vertical anchor) now sits flush at the page top with the body text flowing below it, matching Word, instead of being dropped into the text where its anchor paragraph happens to fall.
